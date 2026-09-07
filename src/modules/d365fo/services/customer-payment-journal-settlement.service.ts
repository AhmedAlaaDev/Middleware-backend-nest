import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

const SETTLEMENT_ENDPOINT = '/data/PaymentJournalLineSettledInvoices';
const JOURNAL_LINE_ENDPOINT = '/data/CustomerPaymentJournalLines';
const CUST_TRANS_ENDPOINT = '/data/CustTransBiEntities';

export interface CustomerPaymentJournalSettlementTarget {
  lineNumber: number;
  invoiceNumber: string;
  settlementAmount: number;
  customerAccount: string;
}

export interface CustomerPaymentJournalSettlementPayload {
  JournalLineCompany: string;
  JournalBatchNumber: string;
  JournalLineNumber: number;
  InvoiceNumber: string;
  InvoiceCompany: string;
  InvoiceDueDate: string;
  SettlementAmountInInvoiceCurrency: number;
  CashDiscountToTakeInInvoiceCurrency: number;
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
  SettleAmountCur?: string | number;
  DueDate?: string;
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
  }): Promise<void> {
    const company = String(options.company ?? '').trim();
    const journalBatchNumber = String(options.journalBatchNumber ?? '').trim();
    if (!company || !journalBatchNumber || options.targets.length === 0) {
      return;
    }

    const existingLineNumbers = await this.listJournalLineNumbers(
      company,
      journalBatchNumber,
    );
    const invoiceCache = new Map<string, CustTransLookupRow>();

    for (const target of options.targets) {
      await this.createSettlement(
        company,
        journalBatchNumber,
        target,
        existingLineNumbers,
        invoiceCache,
      );
    }
  }

  private async createSettlement(
    company: string,
    journalBatchNumber: string,
    target: CustomerPaymentJournalSettlementTarget,
    existingLineNumbers: Set<number>,
    invoiceCache: Map<string, CustTransLookupRow>,
  ): Promise<void> {
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

    if (
      await this.settlementExists(
        company,
        journalBatchNumber,
        lineNumber,
        invoiceNumber,
      )
    ) {
      this.logger.log(
        `Skipping existing customer settlement for ${journalBatchNumber} line ${lineNumber} invoice ${invoiceNumber}`,
      );
      return;
    }

    const invoice = await this.findOpenInvoice(
      company,
      customerAccount,
      invoiceNumber,
      invoiceCache,
    );
    const invoiceDueDate = String(invoice.DueDate ?? '').trim();
    if (!invoiceDueDate) {
      throw new Error(
        `Open invoice ${invoiceNumber} for customer ${customerAccount} has no due date (journal ${journalBatchNumber} line ${lineNumber}).`,
      );
    }

    const payload: CustomerPaymentJournalSettlementPayload = {
      JournalLineCompany: company,
      JournalBatchNumber: journalBatchNumber,
      JournalLineNumber: lineNumber,
      InvoiceNumber: invoiceNumber,
      InvoiceCompany: company,
      InvoiceDueDate: invoiceDueDate,
      SettlementAmountInInvoiceCurrency: settlementAmount,
      CashDiscountToTakeInInvoiceCurrency: 0,
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
        return;
      }
      throw error;
    }
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

  private async findOpenInvoice(
    company: string,
    customerAccount: string,
    invoiceNumber: string,
    invoiceCache: Map<string, CustTransLookupRow>,
  ): Promise<CustTransLookupRow> {
    const cacheKey = `${company}|${customerAccount}|${invoiceNumber}`.toLowerCase();
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
        'SettleAmountCur',
        'DueDate',
      ],
      top: 20,
      crossCompany: true,
    });
    const response = await this.d365.get<CustTransLookupRow>(endpoint, {
      useCache: false,
    });
    const openInvoices = (response.value ?? []).filter(
      (row) => this.readClosedState(row.Closed) !== true,
    );
    if (openInvoices.length === 0) {
      throw new Error(
        `No open customer invoice ${invoiceNumber} was found for account ${customerAccount} in ${company}.`,
      );
    }

    const withDueDate = openInvoices.filter((row) =>
      String(row.DueDate ?? '').trim(),
    );
    const selected = (withDueDate[0] ?? openInvoices[0]) as CustTransLookupRow;
    invoiceCache.set(cacheKey, selected);
    return selected;
  }

  /** CustTrans `Closed` is a date, with 1900-01-01 representing open. */
  private readClosedState(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    const text = String(value ?? '')
      .trim()
      .toLowerCase();
    if (text === 'yes' || text === 'true' || text === '1') return true;
    if (text === 'no' || text === 'false' || text === '0') return false;
    if (!text) return null;

    const timestamp = Date.parse(String(value));
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
