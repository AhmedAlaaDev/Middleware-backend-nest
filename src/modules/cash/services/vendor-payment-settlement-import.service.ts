import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';
import { ExcelService } from '@/modules/excel/excel.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';

const REQUIRED_HEADERS = [
  'Voucher',
  'Company',
  'Account',
  'Description',
  'Debit',
  'Credit',
  'Currency',
  'Line number',
] as const;
const MAX_IMPORT_ROWS = 1_000;
const PREFLIGHT_CONCURRENCY = 6;
const MONEY_TOLERANCE = 0.01;
const SETTLEMENT_ENDPOINT = '/data/VendorPaymentJournalLineSettledInvoices';

type ImportStatus =
  | 'ready'
  | 'marked_and_verified'
  | 'already_marked'
  | 'invalid'
  | 'post_failed';

interface VendorPaymentExportRow {
  Voucher?: unknown;
  Company?: unknown;
  Account?: unknown;
  Description?: unknown;
  Debit?: unknown;
  Credit?: unknown;
  Currency?: unknown;
  'Line number'?: unknown;
}

interface SettlementCandidate {
  excelRow: number;
  voucher: string;
  company: string;
  vendorAccount: string;
  description: string;
  invoiceNumber: string;
  debitAmount: number;
  creditAmount: number;
  currencyCode: string;
  journalLineNumber: number;
}

interface VendorPaymentJournalLineRow {
  dataAreaId?: string;
  JournalBatchNumber?: string;
  LineNumber?: string | number;
  Voucher?: string;
  AccountDisplayValue?: string;
  DebitAmount?: string | number;
  CreditAmount?: string | number;
  CurrencyCode?: string;
}

interface VendTransRow {
  Invoice?: string;
  AccountNum?: string;
  CurrencyCode?: string;
  Closed?: string | number | boolean;
  AmountCur?: string | number;
  SettleAmountCur?: string | number;
  RemainAmountCur?: string | number;
  DueDate?: string;
  DocumentNum?: string;
  Voucher?: string;
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

export interface VendorPaymentSettlementPayload {
  JournalLineCompany: string;
  JournalBatchNumber: string;
  JournalLineNumber: number;
  InvoiceNumber: string;
  InvoiceCompany: string;
  InvoiceDueDate: string;
  SettlementAmountInInvoiceCurrency: number;
  CashDiscountToTakeInInvoiceCurrency: number;
}

export interface VendorPaymentSettlementImportResult {
  excelRow: number;
  voucher: string;
  journalBatchNumber: string;
  journalLineNumber: number;
  vendorAccount: string;
  invoiceNumber: string;
  settlementAmount: number;
  currencyCode: string;
  status: ImportStatus;
  message: string;
  requestBody?: VendorPaymentSettlementPayload;
}

export interface VendorPaymentSettlementImportResponse {
  dryRun: boolean;
  candidateCount: number;
  summary: {
    ready: number;
    markedAndVerified: number;
    alreadyMarked: number;
    invalid: number;
    postFailed: number;
  };
  results: VendorPaymentSettlementImportResult[];
}

interface PreparedSettlement {
  candidate: SettlementCandidate;
  payload?: VendorPaymentSettlementPayload;
  existing?: ExistingSettlementRow;
  remainingAmount?: number;
  error?: string;
}

@Injectable()
export class VendorPaymentSettlementImportService {
  private readonly logger = new Logger(
    VendorPaymentSettlementImportService.name,
  );

  constructor(
    private readonly excel: ExcelService,
    private readonly d365: D365FOClientService,
    private readonly query: ODataQueryBuilderService,
    private readonly operationalLogs: OperationalLoggerService,
  ) {}

  public async process(
    workbookBuffer: Buffer,
    dryRun = false,
  ): Promise<VendorPaymentSettlementImportResponse> {
    const candidates = await this.readCandidates(workbookBuffer);
    const duplicateRows = this.findDuplicateRows(candidates);
    const prepared = await this.mapWithConcurrency<
      SettlementCandidate,
      PreparedSettlement
    >(candidates, PREFLIGHT_CONCURRENCY, async (candidate) =>
      duplicateRows.has(candidate.excelRow)
        ? {
            candidate,
            error:
              'The workbook contains a duplicate company/voucher/line/invoice row.',
          }
        : await this.prepareSettlement(candidate),
    );
    this.applyAggregateInvoiceValidation(prepared);

    const results: VendorPaymentSettlementImportResult[] = [];
    for (const item of prepared) {
      if (item.error || !item.payload) {
        results.push(
          this.toResult(item, 'invalid', item.error || 'Invalid row'),
        );
        continue;
      }
      if (item.existing) {
        results.push(
          this.toResult(item, 'already_marked', 'Settlement already exists.'),
        );
        continue;
      }
      if (dryRun) {
        results.push(
          this.toResult(item, 'ready', 'Validated and ready to settle.'),
        );
        continue;
      }

      results.push(await this.postAndVerify(item));
    }

    const response: VendorPaymentSettlementImportResponse = {
      dryRun,
      candidateCount: candidates.length,
      summary: {
        ready: results.filter((result) => result.status === 'ready').length,
        markedAndVerified: results.filter(
          (result) => result.status === 'marked_and_verified',
        ).length,
        alreadyMarked: results.filter(
          (result) => result.status === 'already_marked',
        ).length,
        invalid: results.filter((result) => result.status === 'invalid').length,
        postFailed: results.filter((result) => result.status === 'post_failed')
          .length,
      },
      results,
    };

    await this.operationalLogs.emit({
      level:
        response.summary.invalid > 0 || response.summary.postFailed > 0
          ? 'warn'
          : 'info',
      message: dryRun
        ? `Vendor payment settlement workbook validated with ${response.summary.ready} ready row(s)`
        : `Vendor payment settlement workbook processed with ${response.summary.markedAndVerified} verified mark(s)`,
      context: VendorPaymentSettlementImportService.name,
      eventType: 'd365fo.vendor-payment-settlement-import',
      status: dryRun ? 'validated' : 'processed',
      metadata: {
        dryRun,
        candidateCount: response.candidateCount,
        ...response.summary,
        invalidRows: results
          .filter((result) => result.status === 'invalid')
          .map((result) => result.excelRow),
        failedRows: results
          .filter((result) => result.status === 'post_failed')
          .map((result) => result.excelRow),
      },
    });

    return response;
  }

  private async readCandidates(buffer: Buffer): Promise<SettlementCandidate[]> {
    const sheet =
      await this.excel.excelToSheetData<VendorPaymentExportRow>(buffer);
    const missingHeaders = REQUIRED_HEADERS.filter(
      (header) => !sheet.headers.includes(header),
    );
    if (missingHeaders.length > 0) {
      throw new BadRequestException(
        `Vendor payment settlement workbook is missing required column(s): ${missingHeaders.join(', ')}`,
      );
    }
    if (sheet.rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `Vendor payment settlement workbook contains ${sheet.rows.length} rows; the limit is ${MAX_IMPORT_ROWS}.`,
      );
    }

    const candidates = sheet.rows.flatMap((row, index) => {
      const description = this.asText(row.Description);
      const invoiceNumber = this.invoiceFromDescription(description);
      if (!invoiceNumber) return [];

      const candidate: SettlementCandidate = {
        excelRow: index + 2,
        voucher: this.asText(row.Voucher),
        company: this.asText(row.Company),
        vendorAccount: this.asText(row.Account),
        description,
        invoiceNumber,
        debitAmount: this.asNumber(row.Debit),
        creditAmount: this.asNumber(row.Credit),
        currencyCode: this.asText(row.Currency),
        journalLineNumber: this.asNumber(row['Line number']),
      };
      return [candidate];
    });

    if (candidates.length === 0) {
      throw new BadRequestException(
        'No rows with a Description matching "Unmarked - <invoice>" were found.',
      );
    }
    return candidates;
  }

  private async prepareSettlement(
    candidate: SettlementCandidate,
  ): Promise<PreparedSettlement> {
    try {
      this.validateCandidate(candidate);
      const journalLine = await this.findJournalLine(candidate);
      this.validateJournalLine(candidate, journalLine);
      const invoice = await this.findOpenInvoice(candidate);
      const settlementAmount = Number(
        (candidate.creditAmount - candidate.debitAmount).toFixed(2),
      );
      const remainingAmount = this.remainingInvoiceAmount(invoice);
      if (Math.abs(settlementAmount) - remainingAmount > MONEY_TOLERANCE) {
        throw new Error(
          `Settlement ${Math.abs(settlementAmount)} exceeds invoice remainder ${remainingAmount}.`,
        );
      }

      const journalBatchNumber = this.asText(journalLine.JournalBatchNumber);
      const dueDate = this.asText(invoice.DueDate);
      if (!dueDate) throw new Error('The open invoice has no due date.');
      const payload: VendorPaymentSettlementPayload = {
        JournalLineCompany: candidate.company,
        JournalBatchNumber: journalBatchNumber,
        JournalLineNumber: candidate.journalLineNumber,
        InvoiceNumber: candidate.invoiceNumber,
        InvoiceCompany: candidate.company,
        InvoiceDueDate: dueDate,
        SettlementAmountInInvoiceCurrency: settlementAmount,
        CashDiscountToTakeInInvoiceCurrency: 0,
      };
      const existing = await this.findExistingSettlement(payload);
      if (
        existing &&
        !this.moneyEquals(
          existing.SettlementAmountInInvoiceCurrency,
          settlementAmount,
        )
      ) {
        throw new Error(
          `A settlement already exists with a different amount (${existing.SettlementAmountInInvoiceCurrency}).`,
        );
      }
      return { candidate, payload, existing, remainingAmount };
    } catch (error) {
      return { candidate, error: this.errorMessage(error) };
    }
  }

  private validateCandidate(candidate: SettlementCandidate): void {
    const missing = [
      ['Voucher', candidate.voucher],
      ['Company', candidate.company],
      ['Account', candidate.vendorAccount],
      ['Currency', candidate.currencyCode],
      ['Invoice', candidate.invoiceNumber],
    ]
      .filter(([, value]) => !value)
      .map(([field]) => field);
    if (missing.length > 0) {
      throw new Error(`Missing workbook value(s): ${missing.join(', ')}.`);
    }
    if (
      !Number.isInteger(candidate.journalLineNumber) ||
      candidate.journalLineNumber <= 0
    ) {
      throw new Error('Line number must be a positive integer.');
    }
    if (
      candidate.debitAmount < 0 ||
      candidate.creditAmount < 0 ||
      (candidate.debitAmount > 0 && candidate.creditAmount > 0) ||
      (candidate.debitAmount === 0 && candidate.creditAmount === 0)
    ) {
      throw new Error(
        'Exactly one of Debit or Credit must contain a positive amount.',
      );
    }
  }

  private findDuplicateRows(
    candidates: SettlementCandidate[],
  ): ReadonlySet<number> {
    const seen = new Set<string>();
    const duplicates = new Set<number>();
    for (const candidate of candidates) {
      const key = [
        candidate.company,
        candidate.voucher,
        candidate.journalLineNumber,
        candidate.invoiceNumber,
      ]
        .map((value) => String(value).trim().toLowerCase())
        .join('|');
      if (seen.has(key)) duplicates.add(candidate.excelRow);
      else seen.add(key);
    }
    return duplicates;
  }

  private applyAggregateInvoiceValidation(items: PreparedSettlement[]): void {
    const groups = new Map<string, PreparedSettlement[]>();
    for (const item of items) {
      if (item.error || !item.payload) continue;
      const key = [
        item.payload.JournalLineCompany,
        item.candidate.vendorAccount,
        item.payload.InvoiceNumber,
        item.candidate.currencyCode,
      ]
        .map((value) => String(value).trim().toLowerCase())
        .join('|');
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      const remaining = Math.min(
        ...group.map(
          (item) => item.remainingAmount ?? Number.POSITIVE_INFINITY,
        ),
      );
      const requested = group.reduce(
        (sum, item) =>
          sum + Math.abs(item.payload?.SettlementAmountInInvoiceCurrency ?? 0),
        0,
      );
      if (requested - remaining <= MONEY_TOLERANCE) continue;

      for (const item of group) {
        if (item.existing) continue;
        item.error = `Combined workbook settlements for invoice ${item.candidate.invoiceNumber} total ${requested}, exceeding the open remainder ${remaining}.`;
        item.payload = undefined;
      }
    }
  }

  private async findJournalLine(
    candidate: SettlementCandidate,
  ): Promise<VendorPaymentJournalLineRow> {
    const endpoint = this.query.buildQuery('/data/VendorPaymentJournalLines', {
      crossCompany: true,
      top: 2,
      select: [
        'dataAreaId',
        'JournalBatchNumber',
        'LineNumber',
        'Voucher',
        'AccountDisplayValue',
        'DebitAmount',
        'CreditAmount',
        'CurrencyCode',
      ],
      filter: this.query.and(
        this.query.eq('dataAreaId', candidate.company),
        this.query.eq('Voucher', candidate.voucher),
        this.query.eq('LineNumber', candidate.journalLineNumber),
      ),
    });
    const response = await this.d365.get<VendorPaymentJournalLineRow>(
      endpoint,
      {
        useCache: false,
      },
    );
    if (response.value.length !== 1) {
      throw new Error(
        `Expected one D365 vendor payment journal line but found ${response.value.length}.`,
      );
    }
    return response.value[0];
  }

  private validateJournalLine(
    candidate: SettlementCandidate,
    journalLine: VendorPaymentJournalLineRow,
  ): void {
    if (
      this.asText(journalLine.AccountDisplayValue).toLowerCase() !==
      candidate.vendorAccount.toLowerCase()
    ) {
      throw new Error(
        `Vendor mismatch: workbook=${candidate.vendorAccount}, D365=${journalLine.AccountDisplayValue}.`,
      );
    }
    if (this.asText(journalLine.CurrencyCode) !== candidate.currencyCode) {
      throw new Error(
        `Currency mismatch: workbook=${candidate.currencyCode}, D365=${journalLine.CurrencyCode}.`,
      );
    }
    if (
      !this.moneyEquals(journalLine.DebitAmount, candidate.debitAmount) ||
      !this.moneyEquals(journalLine.CreditAmount, candidate.creditAmount)
    ) {
      throw new Error('Journal debit/credit does not match the workbook.');
    }
  }

  private async findOpenInvoice(
    candidate: SettlementCandidate,
  ): Promise<VendTransRow> {
    const endpoint = this.query.buildQuery('/data/VendTransBiEntities', {
      crossCompany: true,
      top: 20,
      select: [
        'Invoice',
        'AccountNum',
        'CurrencyCode',
        'Closed',
        'AmountCur',
        'SettleAmountCur',
        'RemainAmountCur',
        'DueDate',
        'DocumentNum',
        'Voucher',
      ],
      filter: this.query.and(
        this.query.eq('dataAreaId', candidate.company),
        this.query.eq('AccountNum', candidate.vendorAccount),
        this.query.eq('Invoice', candidate.invoiceNumber),
      ),
    });
    const response = await this.d365.get<VendTransRow>(endpoint, {
      useCache: false,
    });
    const openInvoices = response.value.filter(
      (row) =>
        this.isOpenInvoice(row) &&
        this.asText(row.CurrencyCode) === candidate.currencyCode,
    );
    if (openInvoices.length !== 1) {
      throw new Error(
        `Expected one open invoice transaction but found ${openInvoices.length}.`,
      );
    }
    return openInvoices[0];
  }

  private async findExistingSettlement(
    payload: VendorPaymentSettlementPayload,
  ): Promise<ExistingSettlementRow | undefined> {
    const endpoint = this.query.buildQuery(SETTLEMENT_ENDPOINT, {
      crossCompany: true,
      top: 2,
      select: [
        'JournalLineCompany',
        'JournalBatchNumber',
        'JournalLineNumber',
        'InvoiceNumber',
        'InvoiceCompany',
        'InvoiceDueDate',
        'SettlementAmountInInvoiceCurrency',
      ],
      filter: this.query.and(
        this.query.eq('JournalLineCompany', payload.JournalLineCompany),
        this.query.eq('JournalBatchNumber', payload.JournalBatchNumber),
        this.query.eq('JournalLineNumber', payload.JournalLineNumber),
        this.query.eq('InvoiceNumber', payload.InvoiceNumber),
        this.query.eq('InvoiceCompany', payload.InvoiceCompany),
      ),
    });
    const response = await this.d365.get<ExistingSettlementRow>(endpoint, {
      useCache: false,
    });
    if (response.value.length > 1) {
      throw new Error('Multiple matching settlement rows already exist.');
    }
    return response.value[0];
  }

  private async postAndVerify(
    item: PreparedSettlement,
  ): Promise<VendorPaymentSettlementImportResult> {
    const payload = item.payload!;
    try {
      const justBeforePost = await this.findExistingSettlement(payload);
      if (justBeforePost) {
        return this.toResult(
          { ...item, existing: justBeforePost },
          'already_marked',
          'Settlement was created before this row reached the posting step.',
        );
      }

      try {
        await this.d365.post<
          VendorPaymentSettlementPayload,
          ExistingSettlementRow
        >(SETTLEMENT_ENDPOINT, payload, { retries: 0 });
      } catch (error) {
        // A network timeout can occur after D365 commits. Verify before
        // reporting failure so callers can safely retry the file.
        const recovered = await this.findExistingSettlement(payload);
        if (!recovered) throw error;
      }

      const verified = await this.findExistingSettlement(payload);
      if (!verified) {
        throw new Error(
          'D365 accepted the POST but no settlement row was found.',
        );
      }
      if (
        !this.moneyEquals(
          verified.SettlementAmountInInvoiceCurrency,
          payload.SettlementAmountInInvoiceCurrency,
        )
      ) {
        throw new Error(
          `Verified settlement amount ${verified.SettlementAmountInInvoiceCurrency} differs from requested amount ${payload.SettlementAmountInInvoiceCurrency}.`,
        );
      }
      return this.toResult(
        item,
        'marked_and_verified',
        'Settlement created and verified in D365.',
      );
    } catch (error) {
      this.logger.error(
        `Failed to mark Excel row ${item.candidate.excelRow}: ${this.errorMessage(error)}`,
      );
      return this.toResult(item, 'post_failed', this.errorMessage(error));
    }
  }

  private toResult(
    item: PreparedSettlement,
    status: ImportStatus,
    message: string,
  ): VendorPaymentSettlementImportResult {
    const candidate = item.candidate;
    return {
      excelRow: candidate.excelRow,
      voucher: candidate.voucher,
      journalBatchNumber: item.payload?.JournalBatchNumber ?? '',
      journalLineNumber: candidate.journalLineNumber,
      vendorAccount: candidate.vendorAccount,
      invoiceNumber: candidate.invoiceNumber,
      settlementAmount:
        item.payload?.SettlementAmountInInvoiceCurrency ??
        Number((candidate.creditAmount - candidate.debitAmount).toFixed(2)),
      currencyCode: candidate.currencyCode,
      status,
      message,
      ...(item.payload ? { requestBody: item.payload } : {}),
    };
  }

  private invoiceFromDescription(description: string): string {
    return (
      description.match(/^\s*unmarked\s*[-:]\s*(.+?)\s*$/i)?.[1]?.trim() ?? ''
    );
  }

  private asText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value).trim();
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const objectValue = value as { text?: unknown; result?: unknown };
      if (
        typeof objectValue.text === 'string' ||
        typeof objectValue.text === 'number'
      )
        return String(objectValue.text).trim();
      if (
        typeof objectValue.result === 'string' ||
        typeof objectValue.result === 'number'
      )
        return String(objectValue.result).trim();
    }
    return '';
  }

  private asNumber(value: unknown): number {
    const number = Number(value ?? 0);
    if (!Number.isFinite(number)) {
      throw new BadRequestException(
        `Invalid numeric workbook value: ${this.asText(value) || '(non-scalar value)'}`,
      );
    }
    return number;
  }

  private isOpenInvoice(row: VendTransRow): boolean {
    const closed = this.asText(row.Closed).toLowerCase();
    if (!closed || closed.startsWith('1900-01-01')) return true;
    return closed === 'false' || closed === 'no' || closed === '0';
  }

  private remainingInvoiceAmount(row: VendTransRow): number {
    const explicitRemaining = Number(row.RemainAmountCur);
    if (Number.isFinite(explicitRemaining) && explicitRemaining !== 0) {
      return Math.abs(explicitRemaining);
    }
    const original = Math.abs(this.asNumber(row.AmountCur));
    const settled = Math.abs(this.asNumber(row.SettleAmountCur));
    return Math.max(0, original - settled);
  }

  private moneyEquals(left: unknown, right: unknown): boolean {
    return (
      Math.abs(this.asNumber(left) - this.asNumber(right)) <= MONEY_TOLERANCE
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async mapWithConcurrency<T, R>(
    values: T[],
    concurrency: number,
    mapper: (value: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(values.length);
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        results[index] = await mapper(values[index]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, values.length) }, worker),
    );
    return results;
  }
}
