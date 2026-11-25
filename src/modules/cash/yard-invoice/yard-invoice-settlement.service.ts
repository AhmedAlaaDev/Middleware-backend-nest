import { CREDIT_NOTE_PREFIXES, RECEIPT_PREFIXES } from './yard-invoice-flow';
import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

/**
 * Settles the Yard receipts of a posted customer payment journal to their open
 * invoices. Runs only when YARD_INVOICE_SETTLEMENT_ENABLED is 'true'.
 *
 * Safety rules:
 * - Every receipt must match exactly one open invoice (same customer, currency
 *   and amount). If any receipt does not, nothing is settled.
 * - Lines that are already settled are skipped, so a retried job is safe.
 * - Writes are sent one at a time with no client retries. Three failures in a
 *   row stop the run.
 * - The result is read back and reported as a count and a total.
 */
export const YARD_INVOICE_SETTLEMENT_FLAG = 'YARD_INVOICE_SETTLEMENT_ENABLED';

const CHUNK_SIZE = 40;
const MAX_CONSECUTIVE_FAILURES = 3;
const AMOUNT_TOLERANCE = 0.005;
const MAX_REPORTED_PROBLEMS = 20;

export function isYardInvoiceSettlementEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[YARD_INVOICE_SETTLEMENT_FLAG] === 'true';
}

export interface YardJournalLine {
  LineNumber: number;
  TransactionText: string;
  AccountDisplayValue: string;
  CreditAmount: number;
  DebitAmount: number;
  CurrencyCode: string;
}

export interface YardOpenInvoice {
  Invoice: string;
  AccountNum: string;
  CurrencyCode: string;
  AmountCur: number;
  SettleAmountCur: number;
  Voucher: string;
  Closed?: string | null;
  DueDate: string;
}

export interface YardSettlementItem {
  journalLineNumber: number;
  invoiceNumber: string;
  amount: number;
  dueDate: string;
}

export interface YardSettlementReport {
  journalBatchNumber: string;
  company: string;
  yardLines: number;
  alreadySettled: number;
  toSettle: number;
  settled: number;
  failed: number;
  stoppedEarly: boolean;
  problems: string[];
  verifiedRows: number;
  verifiedTotal: number;
}

/** Yard receipt invoice number from the journal line text. */
export function yardInvoiceOf(line: YardJournalLine): string {
  const text = line.TransactionText ?? '';
  const prefix =
    [...RECEIPT_PREFIXES, ...CREDIT_NOTE_PREFIXES].find((p) =>
      text.startsWith(p),
    ) ?? '';
  return text.slice(prefix.length).trim();
}

export function isYardReceiptLine(line: YardJournalLine): boolean {
  const text = line.TransactionText ?? '';
  return [...RECEIPT_PREFIXES, ...CREDIT_NOTE_PREFIXES].some((p) =>
    text.startsWith(p),
  );
}

/** A Yard credit note line: a customer debit settled to the credit note. */
export function isYardCreditNoteLine(line: YardJournalLine): boolean {
  const text = line.TransactionText ?? '';
  return CREDIT_NOTE_PREFIXES.some((p) => text.startsWith(p));
}

/**
 * Pure matching step. Each receipt needs exactly one open invoice row with the
 * same customer, currency and amount. Returns the settlement plan only when
 * every receipt matches; otherwise returns the problems and no plan items.
 */
export function planYardSettlements(
  lines: YardJournalLine[],
  openByInvoice: Map<string, YardOpenInvoice[]>,
): { plan: YardSettlementItem[]; problems: string[] } {
  const plan: YardSettlementItem[] = [];
  const problems: string[] = [];
  for (const line of lines) {
    const invoice = yardInvoiceOf(line);
    const creditNote = isYardCreditNoteLine(line);
    const candidates = (openByInvoice.get(invoice) ?? []).filter(
      creditNote ? isOpenCreditNote : isOpenInvoice,
    );
    const amount = Math.abs(
      Number(line.CreditAmount ?? 0) - Number(line.DebitAmount ?? 0),
    );
    if (candidates.length === 0) {
      problems.push(`${invoice}: no open invoice in D365`);
      continue;
    }
    if (candidates.length > 1) {
      problems.push(
        `${invoice}: ${candidates.length} open invoice rows (ambiguous)`,
      );
      continue;
    }
    const invoiceRow = candidates[0];
    const openAmount = creditNote
      ? Math.abs(Number(invoiceRow.AmountCur)) -
        Math.abs(Number(invoiceRow.SettleAmountCur ?? 0))
      : Number(invoiceRow.AmountCur) - Number(invoiceRow.SettleAmountCur ?? 0);
    const issues: string[] = [];
    if (invoiceRow.AccountNum !== line.AccountDisplayValue) {
      issues.push(
        `customer ${line.AccountDisplayValue} vs invoice ${invoiceRow.AccountNum}`,
      );
    }
    if (
      String(invoiceRow.CurrencyCode ?? '').trim() !==
      String(line.CurrencyCode ?? '').trim()
    ) {
      issues.push(
        `currency ${line.CurrencyCode} vs ${invoiceRow.CurrencyCode}`,
      );
    }
    if (Math.abs(openAmount - amount) > AMOUNT_TOLERANCE) {
      issues.push(`receipt ${amount} vs open ${openAmount}`);
    }
    if (issues.length > 0) {
      problems.push(
        `${invoice} (line ${line.LineNumber}): ${issues.join('; ')}`,
      );
      continue;
    }
    plan.push({
      journalLineNumber: Number(line.LineNumber),
      invoiceNumber: invoice,
      // A credit note is marked with a negative settlement amount.
      amount: creditNote ? -amount : amount,
      dueDate: invoiceRow.DueDate,
    });
  }
  // All or nothing: a single unmatched receipt means no settlement plan at all.
  return problems.length > 0 ? { plan: [], problems } : { plan, problems };
}

function isOpenCreditNote(row: YardOpenInvoice): boolean {
  if (!(Number(row.AmountCur) < 0) || !String(row.Voucher ?? '').trim()) {
    return false;
  }
  return !row.Closed || String(row.Closed).startsWith('1900');
}

function isOpenInvoice(row: YardOpenInvoice): boolean {
  if (!(Number(row.AmountCur) > 0) || !String(row.Voucher ?? '').trim()) {
    return false;
  }
  return !row.Closed || String(row.Closed).startsWith('1900');
}

function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

@Injectable()
export class YardInvoiceSettlementService {
  private readonly logger = new Logger(YardInvoiceSettlementService.name);

  constructor(
    private readonly d365: D365FOClientService,
    private readonly query: ODataQueryBuilderService,
  ) {}

  async settleJournal(input: {
    company: string;
    journalBatchNumber: string;
  }): Promise<YardSettlementReport> {
    const { company, journalBatchNumber } = input;
    const journal = escapeOData(journalBatchNumber);
    const report: YardSettlementReport = {
      journalBatchNumber,
      company,
      yardLines: 0,
      alreadySettled: 0,
      toSettle: 0,
      settled: 0,
      failed: 0,
      stoppedEarly: false,
      problems: [],
      verifiedRows: 0,
      verifiedTotal: 0,
    };

    const lines = (
      await this.readAll<YardJournalLine>(
        this.query.buildQuery('/data/CustomerPaymentJournalLines', {
          filter: `dataAreaId eq '${escapeOData(company)}' and JournalBatchNumber eq '${journal}'`,
          select: [
            'LineNumber',
            'TransactionText',
            'AccountDisplayValue',
            'CreditAmount',
            'DebitAmount',
            'CurrencyCode',
          ],
          top: 5000,
          crossCompany: true,
        }),
      )
    ).filter(isYardReceiptLine);
    report.yardLines = lines.length;

    const settledRows = await this.readSettled(company, journal);
    const settledLines = new Set(
      settledRows.map((row) => Number(row.JournalLineNumber)),
    );
    const todo = lines.filter(
      (line) => !settledLines.has(Number(line.LineNumber)),
    );
    report.alreadySettled = lines.length - todo.length;
    report.toSettle = todo.length;
    if (todo.length === 0) {
      return this.verify(report, company, journal);
    }

    const openByInvoice = await this.readOpenInvoices(company, [
      ...new Set(todo.map(yardInvoiceOf)),
    ]);
    const { plan, problems } = planYardSettlements(todo, openByInvoice);
    if (problems.length > 0) {
      report.problems = problems.slice(0, MAX_REPORTED_PROBLEMS);
      report.toSettle = 0;
      this.logger.warn(
        `Yard settlement for ${journalBatchNumber} stopped before writing: ${problems.length} receipt(s) do not match`,
      );
      return this.verify(report, company, journal);
    }

    const endpoint = this.query.buildQuery(
      '/data/PaymentJournalLineSettledInvoices',
      {
        crossCompany: true,
      },
    );
    let consecutiveFailures = 0;
    for (const item of plan) {
      const body = {
        JournalLineCompany: company,
        JournalBatchNumber: journalBatchNumber,
        JournalLineNumber: item.journalLineNumber,
        InvoiceNumber: item.invoiceNumber,
        InvoiceCompany: company,
        InvoiceDueDate: item.dueDate,
        InvoiceToPaymentCrossRate: 0,
        SettlementAmountInInvoiceCurrency: item.amount,
        CashDiscountToTakeInInvoiceCurrency: 0,
      };
      try {
        // retries: 0 so a timed-out write is never sent twice.
        await this.d365.post(endpoint, body, { retries: 0 });
        report.settled += 1;
        consecutiveFailures = 0;
      } catch (error) {
        report.failed += 1;
        consecutiveFailures += 1;
        report.problems.push(
          `line ${item.journalLineNumber} ${item.invoiceNumber}: write failed (${error instanceof Error ? error.name : 'error'})`,
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          report.stoppedEarly = true;
          break;
        }
      }
    }
    return this.verify(report, company, journal);
  }

  private async verify(
    report: YardSettlementReport,
    company: string,
    journal: string,
  ): Promise<YardSettlementReport> {
    const rows = await this.readSettled(company, journal, true);
    report.verifiedRows = rows.length;
    report.verifiedTotal = rows.reduce(
      (sum, row) => sum + Number(row.SettlementAmountInInvoiceCurrency ?? 0),
      0,
    );
    report.problems = report.problems.slice(0, MAX_REPORTED_PROBLEMS);
    return report;
  }

  /**
   * Settled rows for this journal batch of this company only. The journal batch
   * number is not unique across legal entities, so company is part of the filter.
   */
  private async readSettled(
    company: string,
    journal: string,
    withAmount = false,
  ): Promise<
    Array<{
      JournalLineNumber: number;
      SettlementAmountInInvoiceCurrency?: number;
    }>
  > {
    return this.readAll(
      this.query.buildQuery('/data/PaymentJournalLineSettledInvoices', {
        filter: `JournalLineCompany eq '${escapeOData(company)}' and JournalBatchNumber eq '${journal}'`,
        select: withAmount
          ? ['JournalLineNumber', 'SettlementAmountInInvoiceCurrency']
          : ['JournalLineNumber'],
        top: 5000,
        crossCompany: true,
      }),
    );
  }

  private async readOpenInvoices(
    company: string,
    invoices: string[],
  ): Promise<Map<string, YardOpenInvoice[]>> {
    const byInvoice = new Map<string, YardOpenInvoice[]>();
    for (let i = 0; i < invoices.length; i += CHUNK_SIZE) {
      const chunk = invoices.slice(i, i + CHUNK_SIZE);
      const rows = await this.readAll<YardOpenInvoice>(
        this.query.buildQuery('/data/CustTransBiEntities', {
          filter: `dataAreaId eq '${escapeOData(company)}' and (${chunk
            .map((invoice) => `Invoice eq '${escapeOData(invoice)}'`)
            .join(' or ')})`,
          select: [
            'Invoice',
            'AccountNum',
            'CurrencyCode',
            'AmountCur',
            'SettleAmountCur',
            'Voucher',
            'Closed',
            'DueDate',
          ],
          top: 5000,
          crossCompany: true,
        }),
      );
      for (const row of rows) {
        const list = byInvoice.get(row.Invoice) ?? [];
        list.push(row);
        byInvoice.set(row.Invoice, list);
      }
    }
    return byInvoice;
  }

  private async readAll<T>(endpoint: string): Promise<T[]> {
    const response = await this.d365.get<T>(endpoint, { useCache: false });
    if (response['@odata.nextLink']) {
      throw new Error(
        'D365 returned a page continuation; the read is too large',
      );
    }
    return response.value ?? [];
  }
}
