import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

const SETTLEMENT_ENDPOINT = '/data/PaymentJournalLineSettledInvoices';
const JOURNAL_LINE_ENDPOINT = '/data/CustomerPaymentJournalLines';
const CUST_TRANS_ENDPOINT = '/data/CustTransBiEntities';
const MONEY_TOLERANCE = 0.01;

export interface CustomerPaymentJournalSettlementTarget {
  lineNumber: number;
  invoiceNumber: string;
  settlementAmount: number;
  customerAccount: string;
  transDate?: string;
  currencyCode?: string;
  /** D365 exchange rate field scaled by 100 (for example 4875 = 48.75). */
  paymentExchangeRate?: number;
}

/**
 * A journal line whose invoice could not absorb the full credit. The line is
 * posted unmarked (or partially settled) instead of failing the whole journal;
 * the caller reports these rows on the batch.
 */
export interface CustomerPaymentSettlementSkip {
  lineNumber: number;
  invoiceNumber: string;
  customerAccount: string;
  requestedAmount: number;
  /** 0 when the line stays fully unmarked (cash on account). */
  settledAmount: number;
  reason: string;
}

export interface CustomerPaymentJournalSettlementPayload {
  JournalLineCompany: string;
  JournalBatchNumber: string;
  JournalLineNumber: number;
  InvoiceNumber: string;
  InvoiceCompany: string;
  InvoiceDueDate: string;
  SettlementAmountInInvoiceCurrency: number;
}

interface ExistingSettlementRow {
  JournalLineCompany?: string;
  JournalBatchNumber?: string;
  JournalLineNumber?: string | number;
  InvoiceNumber?: string;
  InvoiceCompany?: string;
  InvoiceDueDate?: string;
  SettlementAmountInInvoiceCurrency?: string | number;
}

interface CustomerJournalLineRow {
  LineNumber?: string | number;
}

interface CustTransLookupRow {
  Invoice?: string;
  AccountNum?: string;
  CurrencyCode?: string;
  Closed?: string | number | boolean;
  AmountCur?: string | number;
  AmountMST?: string | number;
  SettleAmountCur?: string | number;
  DueDate?: string;
  TransDate?: string;
  SourceKey?: string | number;
}

interface OpenInvoiceTrans {
  row: CustTransLookupRow;
  remaining: number;
}

@Injectable()
export class CustomerPaymentJournalSettlementService {
  private readonly logger = new Logger(
    CustomerPaymentJournalSettlementService.name,
  );

  constructor(
    private readonly d365: D365FOClientService,
    private readonly query: ODataQueryBuilderService,
  ) {}

  public async createSettlements(options: {
    company: string;
    journalBatchNumber: string;
    targets: CustomerPaymentJournalSettlementTarget[];
  }): Promise<CustomerPaymentSettlementSkip[]> {
    const company = String(options.company ?? '').trim();
    const journalBatchNumber = String(options.journalBatchNumber ?? '').trim();
    if (!company || !journalBatchNumber || options.targets.length === 0) {
      return [];
    }

    const existingLineNumbers = await this.listJournalLineNumbers(
      company,
      journalBatchNumber,
    );
    const existingSettlements = await this.listExistingSettlements(
      company,
      journalBatchNumber,
    );
    const invoiceCache = new Map<string, CustTransLookupRow[]>();
    const consumedByTrans = new Map<string, number>();
    const skips: CustomerPaymentSettlementSkip[] = [];

    for (const target of options.targets) {
      const skip = await this.createSettlement(
        company,
        journalBatchNumber,
        target,
        existingLineNumbers,
        existingSettlements,
        invoiceCache,
        consumedByTrans,
      );
      if (skip) skips.push(skip);
    }
    return skips;
  }

  private async createSettlement(
    company: string,
    journalBatchNumber: string,
    target: CustomerPaymentJournalSettlementTarget,
    existingLineNumbers: Set<number>,
    existingSettlements: ExistingSettlementRow[],
    invoiceCache: Map<string, CustTransLookupRow[]>,
    consumedByTrans: Map<string, number>,
  ): Promise<CustomerPaymentSettlementSkip | undefined> {
    const invoiceNumber = String(target.invoiceNumber ?? '').trim();
    const customerAccount = String(target.customerAccount ?? '').trim();
    const lineNumber = Number(target.lineNumber);
    const settlementAmount = Number(target.settlementAmount ?? 0);
    if (
      !invoiceNumber ||
      !customerAccount ||
      !(lineNumber > 0) ||
      !(settlementAmount > 0)
    ) {
      throw new Error(
        `Customer settlement for journal ${journalBatchNumber} line ${target.lineNumber} is missing invoice, customer, line number, or amount.`,
      );
    }

    if (!existingLineNumbers.has(lineNumber)) {
      throw new Error(
        `Customer settlement for journal ${journalBatchNumber} line ${lineNumber} invoice ${invoiceNumber}: CustomerPaymentJournalLines has no line ${lineNumber}.`,
      );
    }

    const alreadyPosted = this.findExistingSettlement(
      existingSettlements,
      lineNumber,
      invoiceNumber,
    );
    const openInvoices = await this.findOpenInvoices(
      company,
      customerAccount,
      invoiceNumber,
      invoiceCache,
    );
    if (alreadyPosted) {
      const existingAmount = Math.abs(
        this.readNumber(alreadyPosted.SettlementAmountInInvoiceCurrency),
      );
      const matched =
        this.matchInvoiceByDueDate(
          openInvoices,
          alreadyPosted.InvoiceDueDate,
          existingAmount || settlementAmount,
        ) ?? openInvoices[0];
      if (matched) {
        this.consumeAmount(consumedByTrans, matched, existingAmount);
      }
      this.logger.log(
        `Skipping existing customer settlement for ${journalBatchNumber} line ${lineNumber} invoice ${invoiceNumber}`,
      );
      return undefined;
    }

    if (openInvoices.length === 0) {
      return this.buildSkip(
        target,
        0,
        `No open customer transaction was found for invoice ${invoiceNumber} (customer ${customerAccount}, ${company}). Line posted unmarked (cash on account).`,
      );
    }

    // Pick the open trans with the most remaining room; cap the settlement to
    // what is actually left so one under-funded invoice cannot fail (and roll
    // back) the entire journal.
    const settlementAmountInInvoiceCurrency = this.convertPaymentToInvoiceCurrency(
      openInvoices,
      target,
    );
    if (!(settlementAmountInInvoiceCurrency > 0)) {
      return this.buildSkip(
        target,
        0,
        `Could not convert ${settlementAmount} ${target.currencyCode || 'payment currency'} to the invoice currency for ${invoiceNumber}; a valid payment exchange rate and invoice accounting amount are required. Line posted unmarked (cash on account).`,
      );
    }

    const picked = this.selectCappedSettlement(
      openInvoices,
      settlementAmountInInvoiceCurrency,
      target,
      consumedByTrans,
    );
    if (!picked) {
      return this.buildSkip(
        target,
        0,
        `Invoice ${invoiceNumber} has no remaining open amount (already settled or marked by earlier lines). Line posted unmarked (cash on account).`,
      );
    }
    const { invoice, amountToSettle } = picked;

    const invoiceDueDate = String(invoice.DueDate ?? '').trim();
    if (!invoiceDueDate) {
      return this.buildSkip(
        target,
        0,
        `Open invoice ${invoiceNumber} for customer ${customerAccount} has no due date; settlement was not created. Line posted unmarked (cash on account).`,
      );
    }

    const payload: CustomerPaymentJournalSettlementPayload = {
      JournalLineCompany: company,
      JournalBatchNumber: journalBatchNumber,
      JournalLineNumber: lineNumber,
      InvoiceNumber: invoiceNumber,
      InvoiceCompany: company,
      InvoiceDueDate: invoiceDueDate,
      SettlementAmountInInvoiceCurrency: amountToSettle,
    };

    try {
      await this.d365.post<
        CustomerPaymentJournalSettlementPayload,
        ExistingSettlementRow
      >(SETTLEMENT_ENDPOINT, payload, { retries: 0 });
    } catch (error) {
      if (
        await this.settlementExists(
          company,
          journalBatchNumber,
          lineNumber,
          invoiceNumber,
        )
      ) {
        this.logger.log(
          `Recovered customer settlement for ${journalBatchNumber} line ${lineNumber} invoice ${invoiceNumber} after RecId 0 / write error`,
        );
        this.consumeAmount(consumedByTrans, invoice, amountToSettle);
        return this.partialSkipOrNone(target, amountToSettle);
      }
      throw error;
    }

    this.consumeAmount(consumedByTrans, invoice, amountToSettle);
    return this.partialSkipOrNone(target, amountToSettle);
  }

  /**
   * The open trans that can absorb the largest part of this line's credit,
   * with the settle amount capped to its remaining balance. Prefers a trans
   * that fully covers the amount (date-matched first); undefined when nothing
   * remains open.
   */
  private selectCappedSettlement(
    openInvoices: CustTransLookupRow[],
    settlementAmount: number,
    target: CustomerPaymentJournalSettlementTarget,
    consumedByTrans: Map<string, number>,
  ): { invoice: CustTransLookupRow; amountToSettle: number } | undefined {
    const candidates = openInvoices
      .map((row) => ({
        row,
        remaining: this.remainingAmount(row, consumedByTrans),
      }))
      .filter((candidate) => candidate.remaining > MONEY_TOLERANCE);

    if (candidates.length === 0) return undefined;

    const covering = candidates.filter(
      (candidate) => candidate.remaining + MONEY_TOLERANCE >= settlementAmount,
    );
    if (covering.length > 0) {
      return {
        invoice: this.pickBestInvoice(covering, settlementAmount, target).row,
        amountToSettle: settlementAmount,
      };
    }

    const best = candidates.reduce((left, right) =>
      right.remaining > left.remaining ? right : left,
    );
    return {
      invoice: best.row,
      amountToSettle: this.roundMoney(best.remaining),
    };
  }

  private partialSkipOrNone(
    target: CustomerPaymentJournalSettlementTarget,
    settledAmount: number,
  ): CustomerPaymentSettlementSkip | undefined {
    const requested = Number(target.settlementAmount ?? 0);
    if (settledAmount + MONEY_TOLERANCE >= requested) return undefined;
    const unsettled = this.roundMoney(requested - settledAmount);
    return this.buildSkip(
      target,
      settledAmount,
      `Invoice ${String(target.invoiceNumber ?? '').trim()} had only ${settledAmount} remaining of the requested ${requested}; ${unsettled} stays unsettled (cash on account).`,
    );
  }

  private buildSkip(
    target: CustomerPaymentJournalSettlementTarget,
    settledAmount: number,
    reason: string,
  ): CustomerPaymentSettlementSkip {
    const skip: CustomerPaymentSettlementSkip = {
      lineNumber: Number(target.lineNumber),
      invoiceNumber: String(target.invoiceNumber ?? '').trim(),
      customerAccount: String(target.customerAccount ?? '').trim(),
      requestedAmount: Number(target.settlementAmount ?? 0),
      settledAmount,
      reason,
    };
    this.logger.warn(
      `Customer settlement skipped/partial for line ${skip.lineNumber} invoice ${skip.invoiceNumber}: ${reason}`,
    );
    return skip;
  }

  private async listJournalLineNumbers(
    company: string,
    journalBatchNumber: string,
  ): Promise<Set<number>> {
    const endpoint = this.query.buildQuery(JOURNAL_LINE_ENDPOINT, {
      filter: this.query.and(
        this.query.eq('dataAreaId', company),
        this.query.eq('JournalBatchNumber', journalBatchNumber),
      ),
      select: ['LineNumber'],
      crossCompany: true,
    });
    const response = await this.d365.get<CustomerJournalLineRow>(endpoint, {
      useCache: false,
    });
    return new Set(
      (response.value ?? [])
        .map((row) => Number(row.LineNumber))
        .filter((lineNumber) => lineNumber > 0),
    );
  }

  private async listExistingSettlements(
    company: string,
    journalBatchNumber: string,
  ): Promise<ExistingSettlementRow[]> {
    const endpoint = this.query.buildQuery(SETTLEMENT_ENDPOINT, {
      filter: this.query.and(
        this.query.eq('JournalLineCompany', company),
        this.query.eq('JournalBatchNumber', journalBatchNumber),
      ),
      select: [
        'JournalLineNumber',
        'InvoiceNumber',
        'InvoiceDueDate',
        'SettlementAmountInInvoiceCurrency',
      ],
      top: 5000,
      crossCompany: true,
    });
    const response = await this.d365.get<ExistingSettlementRow>(endpoint, {
      useCache: false,
    });
    return response.value ?? [];
  }

  private pickBestInvoice(
    covering: OpenInvoiceTrans[],
    settlementAmount: number,
    target: CustomerPaymentJournalSettlementTarget,
  ): OpenInvoiceTrans {
    const paymentDate = this.dateKey(target.transDate);
    const scored = covering.map((candidate) => {
      const dueDate = this.dateKey(candidate.row.DueDate);
      const transDate = this.dateKey(candidate.row.TransDate);
      const dateMatch =
        paymentDate && (dueDate === paymentDate || transDate === paymentDate)
          ? 0
          : 1;
      return {
        candidate,
        dateMatch,
        leftover: candidate.remaining - settlementAmount,
      };
    });
    scored.sort((left, right) => {
      if (left.dateMatch !== right.dateMatch) {
        return left.dateMatch - right.dateMatch;
      }
      return left.leftover - right.leftover;
    });
    return scored[0].candidate;
  }

  private async findOpenInvoices(
    company: string,
    customerAccount: string,
    invoiceNumber: string,
    invoiceCache: Map<string, CustTransLookupRow[]>,
  ): Promise<CustTransLookupRow[]> {
    const cacheKey =
      `${company}|${customerAccount}|${invoiceNumber}`.toLowerCase();
    const cached = invoiceCache.get(cacheKey);
    if (cached) return cached;

    const endpoint = this.query.buildQuery(CUST_TRANS_ENDPOINT, {
      filter: this.query.and(
        this.query.eq('dataAreaId', company),
        this.query.eq('AccountNum', customerAccount),
        this.query.eq('Invoice', invoiceNumber),
      ),
      select: [
        'Invoice',
        'AccountNum',
        'CurrencyCode',
        'Closed',
        'AmountCur',
        'AmountMST',
        'SettleAmountCur',
        'DueDate',
        'TransDate',
        'SourceKey',
      ],
      top: 50,
      crossCompany: true,
    });
    const response = await this.d365.get<CustTransLookupRow>(endpoint, {
      useCache: false,
    });
    const openInvoices = (response.value ?? []).filter((row) => {
      if (this.readClosedState(row.Closed) === true) return false;
      if (this.readNumber(row.AmountCur) < -MONEY_TOLERANCE) return false;
      return this.originalAmount(row) > MONEY_TOLERANCE;
    });
    // No open trans is a skip (line stays unmarked), not a journal failure.
    invoiceCache.set(cacheKey, openInvoices);
    return openInvoices;
  }

  private remainingAmount(
    row: CustTransLookupRow,
    consumedByTrans: Map<string, number>,
  ): number {
    const original = this.originalAmount(row);
    const settled = Math.abs(this.readNumber(row.SettleAmountCur));
    const consumed = consumedByTrans.get(this.transKey(row)) ?? 0;
    return Math.max(0, this.roundMoney(original - settled - consumed));
  }

  private originalAmount(row: CustTransLookupRow): number {
    const amountCur = this.readNumber(row.AmountCur);
    if (amountCur !== 0) return Math.abs(amountCur);
    return Math.abs(this.readNumber(row.AmountMST));
  }

  private consumeAmount(
    consumedByTrans: Map<string, number>,
    row: CustTransLookupRow,
    amount: number,
  ): void {
    const key = this.transKey(row);
    consumedByTrans.set(key, (consumedByTrans.get(key) ?? 0) + amount);
  }

  private transKey(row: CustTransLookupRow): string {
    const sourceKey = String(row.SourceKey ?? '').trim();
    if (sourceKey) return `source:${sourceKey}`;
    return `due:${this.dateKey(row.DueDate)}|amt:${this.originalAmount(row)}`;
  }

  private matchInvoiceByDueDate(
    openInvoices: CustTransLookupRow[],
    dueDate: unknown,
    amount: number,
  ): CustTransLookupRow | undefined {
    const dueKey = this.dateKey(dueDate);
    const matches = dueKey
      ? openInvoices.filter((row) => this.dateKey(row.DueDate) === dueKey)
      : openInvoices;
    const pool = matches.length > 0 ? matches : openInvoices;
    return [...pool].sort(
      (left, right) =>
        Math.abs(this.originalAmount(left) - amount) -
        Math.abs(this.originalAmount(right) - amount),
    )[0];
  }

  private convertPaymentToInvoiceCurrency(
    openInvoices: CustTransLookupRow[],
    target: CustomerPaymentJournalSettlementTarget,
  ): number {
    const paymentAmount = Number(target.settlementAmount ?? 0);
    const paymentCurrency = String(target.currencyCode ?? '').trim().toUpperCase();
    const invoice = openInvoices[0];
    const invoiceCurrency = String(invoice?.CurrencyCode ?? '').trim().toUpperCase();
    if (!(paymentAmount > 0)) return 0;
    // Preserve legacy same-currency behavior when an older formatted line
    // omitted the optional payment currency field.
    if (!paymentCurrency) return paymentAmount;
    // Legacy Finance responses may omit CurrencyCode for a same-currency
    // transaction. Preserve the pre-existing amount behavior in that case.
    if (!invoiceCurrency || paymentCurrency === invoiceCurrency) return paymentAmount;
    if (paymentCurrency === invoiceCurrency) return paymentAmount;

    const paymentRate = Number(target.paymentExchangeRate) / 100;
    const invoiceAmount = Math.abs(this.readNumber(invoice?.AmountCur));
    const invoiceAmountMst = Math.abs(this.readNumber(invoice?.AmountMST));
    const invoiceRate = invoiceAmount > MONEY_TOLERANCE
      ? invoiceAmountMst / invoiceAmount
      : 0;
    if (!(paymentRate > 0) || !(invoiceRate > 0)) return 0;

    // Both rates are expressed through the accounting currency (EGP). The
    // result is therefore the payment amount in invoice currency.
    return this.roundMoney((paymentAmount * paymentRate) / invoiceRate);
  }

  private dateKey(value: unknown): string {
    const match = this.asText(value).match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  }

  private asText(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return '';
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private readNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private findExistingSettlement(
    existingSettlements: ExistingSettlementRow[],
    lineNumber: number,
    invoiceNumber: string,
  ): ExistingSettlementRow | undefined {
    const invoice = invoiceNumber.trim().toLowerCase();
    return existingSettlements.find(
      (row) =>
        Number(row.JournalLineNumber) === lineNumber &&
        String(row.InvoiceNumber ?? '')
          .trim()
          .toLowerCase() === invoice,
    );
  }

  /** CustTrans `Closed` is a date, with 1900-01-01 representing open. */
  private readClosedState(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    const text = this.asText(value).toLowerCase();
    if (text === 'yes' || text === 'true' || text === '1') return true;
    if (text === 'no' || text === 'false' || text === '0') return false;
    if (!text) return null;

    const timestamp = Date.parse(this.asText(value));
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp).getUTCFullYear() > 1900;
  }

  private async settlementExists(
    company: string,
    journalBatchNumber: string,
    lineNumber: number,
    invoiceNumber: string,
  ): Promise<boolean> {
    const endpoint = this.query.buildQuery(SETTLEMENT_ENDPOINT, {
      filter: this.query.and(
        this.query.eq('JournalLineCompany', company),
        this.query.eq('JournalBatchNumber', journalBatchNumber),
        this.query.eq('JournalLineNumber', lineNumber),
        this.query.eq('InvoiceNumber', invoiceNumber),
      ),
      top: 1,
      crossCompany: true,
    });
    const response = await this.d365.get<ExistingSettlementRow>(endpoint, {
      useCache: false,
    });
    return (response.value ?? []).length > 0;
  }
}
