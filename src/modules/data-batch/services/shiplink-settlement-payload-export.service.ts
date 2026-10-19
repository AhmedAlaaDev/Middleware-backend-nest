import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ExcelService } from '@/modules/excel/excel.service';

const MONEY_TOLERANCE = 0.01;
const LOOKUP_CONCURRENCY = 6;
const DEFAULT_COMPANY = 'm-p';
const SKIP_SETTLEMENT_METHODS = new Set(['remove', 'no settlement']);
const SKIP_STATUSES = new Set(['remove']);
const INVOICE_ID_COLUMNS = [
  'InvoiceNumber',
  'Invoice',
  'INVOICE',
  'FREETEXTNUMBER',
  'MarkedInvoice',
];
const DUE_DATE_COLUMNS = [
  'DueDate',
  'InvoiceDueDate',
  'INVOICEDUEDATE',
  'InvoiceDate',
  'INVOICEDATE',
  'DUEDATE',
];
const PAYMENT_DATE_COLUMNS = [
  'TransDate',
  'TRANSDATE',
  'TransactionDate',
  'DocumentDate',
  'DOCUMENTDATE',
];
const UNIQUE_ID_COLUMNS = ['UniqueId', 'UNIQUEID'];

interface InvoiceFileIndex {
  uniqueIds: Set<string>;
  invoices: Set<string>;
  amountKeys: Set<string>;
  dueDatesByUniqueId: Map<string, string[]>;
  dueDatesByInvoice: Map<string, string[]>;
}

interface FinanceJournalLine {
  JournalBatchNumber?: string;
  LineNumber?: string | number;
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

interface CustomerTransaction {
  Invoice?: string;
  AccountNum?: string;
  CurrencyCode?: string;
  Closed?: string | number | boolean;
  AmountCur?: string | number;
  AmountMST?: string | number;
  SettleAmountCur?: string | number;
  RemainAmountCur?: string | number;
  DueDate?: string;
  TransDate?: string;
}

interface SettlementSourceRow {
  plannedBatch: string;
  lineNumber: number;
  company: string;
  customerAccount: string;
  invoiceNumber: string;
  paymentAmount: number;
  paymentCurrency: string;
  paymentExchangeRate: number;
  excelRow: number;
}

export interface ShiplinkSettlementPayload {
  JournalLineCompany: string;
  JournalBatchNumber: string;
  JournalLineNumber: number;
  InvoiceNumber: string;
  InvoiceCompany: string;
  InvoiceDueDate: string;
  SettlementAmountInInvoiceCurrency: number;
}

export interface ShiplinkSettlementDifferenceReport {
  batchId: string;
  company: string;
  expectedCount: number;
  settledCount: number;
  notSettledCount: number;
  amountMismatchCount: number;
  extraSettlementCount: number;
  expectedAmount: number;
  settledAmount: number;
  differenceAmount: number;
  settled: Array<ShiplinkSettlementPayload & { voucher: string }>;
  notSettled: Array<ShiplinkSettlementPayload & { voucher: string }>;
  amountMismatches: Array<{
    expected: ShiplinkSettlementPayload & { voucher: string };
    actual: ExistingSettlementRow;
  }>;
  extraSettlements: ExistingSettlementRow[];
}

export interface ShiplinkUnsettledLinesReport {
  batchId: string;
  company: string;
  remainingLines: Array<
    ShiplinkSettlementPayload & {
      voucher: string;
      status: 'NOT_SETTLED' | 'AMOUNT_MISMATCH';
    }
  >;
  unmatchedFinanceLines: FinanceJournalLine[];
}

export interface ShiplinkSettlementPostReport {
  journalBatchNumber: string;
  company: string;
  requestedCount: number;
  postedCount: number;
  alreadySettledCount: number;
  amountMismatchCount: number;
  failedCount: number;
  posted: ShiplinkSettlementPayload[];
  alreadySettled: ShiplinkSettlementPayload[];
  amountMismatches: Array<{
    expected: ShiplinkSettlementPayload;
    actual: ExistingSettlementRow;
  }>;
  failures: Array<{
    payload: ShiplinkSettlementPayload;
    error: string;
  }>;
}

export interface ShiplinkSettlementExcelSkip {
  excelRow: number;
  invoice: string;
  journalBatchNumber: string;
  reason: string;
}

export interface ShiplinkSettlementExcelReport
  extends ShiplinkSettlementPostReport {
  dryRun: boolean;
  sourceRowCount: number;
  skippedCount: number;
  missingDueDateCount: number;
  skipped: ShiplinkSettlementExcelSkip[];
  payloads?: ShiplinkSettlementPayload[];
}

@Injectable()
export class ShiplinkSettlementPayloadExportService {
  constructor(
    private readonly batches: DataBatchService,
    private readonly d365: D365FOClientService,
    private readonly query: ODataQueryBuilderService,
    private readonly excel: ExcelService,
  ) {}

  public async export(batchId: string): Promise<ShiplinkSettlementPayload[]> {
    const batch = await this.batches.getByIdAsync(batchId);
    if (!batch)
      throw new NotFoundException(`Data batch ${batchId} was not found`);
    if (batch.entryProcessorType !== EntryProcessorTypes.CashInShiplink) {
      throw new BadRequestException(
        'Settlement payload export is only supported for Shiplink Cash-In batches.',
      );
    }
    if (!batch.dfoJournalMappings?.length) {
      throw new BadRequestException(
        'Finance journal mappings are not available. Post the Shiplink batch to Finance before exporting settlement payloads.',
      );
    }

    const rows = (await this.batches.getEnhancedRecordsAsync(batchId))
      .map((record, index) =>
        this.toSourceRow(record.data, batch.company, index + 2),
      )
      .filter((row): row is SettlementSourceRow => row !== undefined);
    if (rows.length === 0) {
      throw new BadRequestException(
        'No Shiplink customer invoice rows were found in the enhanced batch.',
      );
    }

    const actualBatchByPlanned = new Map(
      batch.dfoJournalMappings.map((mapping) => [
        mapping.plannedJournalBatchNumber.trim(),
        mapping.financeJournalBatchNumber.trim(),
      ]),
    );
    const actualBatches = [...new Set(actualBatchByPlanned.values())];
    const financeLines = await this.loadFinanceLines(
      batch.company,
      actualBatches,
    );
    const failures: string[] = [];
    const payloads: ShiplinkSettlementPayload[] = [];

    const mapped = await this.mapWithConcurrency(
      rows,
      LOOKUP_CONCURRENCY,
      async (row) => {
        try {
          const actualBatch = actualBatchByPlanned.get(row.plannedBatch);
          if (!actualBatch)
            throw new Error(
              `No Finance batch mapping exists for planned batch ${row.plannedBatch}.`,
            );
          const financeLine = financeLines.get(
            this.financeLineKey(actualBatch, row.lineNumber),
          );
          if (!financeLine) {
            throw new Error(
              `Finance line ${row.lineNumber} was not found in batch ${actualBatch}.`,
            );
          }
          const transaction = await this.findInvoiceTransaction(row);
          const settlementAmount = this.convertToInvoiceCurrency(
            transaction,
            row,
          );
          if (!(settlementAmount > 0)) {
            throw new Error(
              `Could not calculate a valid settlement amount for invoice ${row.invoiceNumber}.`,
            );
          }
          const dueDate = this.asText(transaction.DueDate);
          if (!dueDate)
            throw new Error(
              `Invoice ${row.invoiceNumber} has no due date in Finance.`,
            );

          return {
            JournalLineCompany: row.company,
            JournalBatchNumber: actualBatch,
            JournalLineNumber: Number(financeLine.LineNumber),
            InvoiceNumber: row.invoiceNumber,
            InvoiceCompany: row.company,
            InvoiceDueDate: dueDate,
            SettlementAmountInInvoiceCurrency: settlementAmount,
          } satisfies ShiplinkSettlementPayload;
        } catch (error) {
          failures.push(
            `Excel row ${row.excelRow}: ${this.errorMessage(error)}`,
          );
          return undefined;
        }
      },
    );

    payloads.push(
      ...mapped.filter(
        (payload): payload is ShiplinkSettlementPayload =>
          payload !== undefined,
      ),
    );
    if (failures.length > 0) {
      throw new BadRequestException(
        `Settlement payload export stopped because ${failures.length} row(s) could not be resolved: ${failures.slice(0, 20).join(' | ')}`,
      );
    }
    return payloads;
  }

  /**
   * Filter a complete SettlementLines.json array without reading Mongo or
   * Finance. This is intended for the recovery/Postman workflow where the
   * uploaded file already contains the exact PaymentJournalLineSettledInvoices
   * bodies.
   */
  public filterUploadedPayloadsByJournalBatch(
    input: unknown,
    journalBatchNumber: string,
  ): ShiplinkSettlementPayload[] {
    const normalizedBatch = this.asText(journalBatchNumber);
    if (!normalizedBatch) {
      throw new BadRequestException(
        'journalBatchNumber query parameter is required.',
      );
    }
    if (!Array.isArray(input)) {
      throw new BadRequestException(
        'Request body must be the complete SettlementLines JSON array.',
      );
    }

    const payloads = input.map((value, index) =>
      this.normalizeUploadedPayload(value, index),
    );
    const matching = payloads.filter(
      (payload) =>
        payload.JournalBatchNumber.toLowerCase() ===
        normalizedBatch.toLowerCase(),
    );
    if (matching.length === 0) {
      const batchesInBody = [
        ...new Set(payloads.map((payload) => payload.JournalBatchNumber)),
      ];
      if (batchesInBody.length === 1) {
        return payloads;
      }
      throw new BadRequestException(
        `No settlement lines were found for journal batch ${normalizedBatch}. The pasted JSON contains: ${batchesInBody.join(', ') || '(none)'}. Use /shiplink-settlement/post-lines for a single generated batch file, or set journalBatchNumber to one of those values.`,
      );
    }
    return matching;
  }

  /**
   * Resolve payloads by the journal number Finance generated internally, for
   * example Mesco-000016627. The middleware batch id is deliberately not part
   * of this public operation.
   */
  public async exportByJournalBatchNumber(
    journalBatchNumber: string,
  ): Promise<ShiplinkSettlementPayload[]> {
    const normalized = journalBatchNumber.trim();
    if (!normalized) {
      throw new BadRequestException('journalBatchNumber is required.');
    }

    const batch =
      await this.batches.getByFinanceJournalBatchNumberAsync(normalized);
    if (!batch) {
      throw new NotFoundException(
        `No middleware Shiplink batch is mapped to Finance journal ${normalized}.`,
      );
    }

    const payloads = await this.export(batch.id);
    const matching = payloads.filter(
      (payload) =>
        payload.JournalBatchNumber.trim().toLowerCase() ===
        normalized.toLowerCase(),
    );
    if (matching.length === 0) {
      throw new BadRequestException(
        `Finance journal ${normalized} has no Shiplink settlement lines in the mapped batch.`,
      );
    }
    return matching;
  }

  /**
   * Post only missing settlement rows for a Finance journal batch. Existing
   * exact rows are skipped; an existing row with a different amount is
   * reported and never duplicated.
   */
  public async settleByJournalBatchNumber(
    journalBatchNumber: string,
  ): Promise<ShiplinkSettlementPostReport> {
    const payloads = await this.exportByJournalBatchNumber(journalBatchNumber);
    return this.postPayloads(payloads);
  }

  /** Post a selected batch from a pasted SettlementLines.json array. */
  public async settleUploadedPayloadsByJournalBatch(
    input: unknown,
    journalBatchNumber?: string,
  ): Promise<ShiplinkSettlementPostReport> {
    if (!this.asText(journalBatchNumber)) {
      return this.settleUploadedPayloads(input);
    }
    const payloads = this.filterUploadedPayloadsByJournalBatch(
      input,
      journalBatchNumber ?? '',
    );
    return this.postPayloads(payloads);
  }

  /**
   * Post every row in a generated batch JSON array, one D365 request at a
   * time, to PaymentJournalLineSettledInvoices. The invoice due date is
   * resolved from the open customer transaction before each write.
   */
  public async settleUploadedPayloads(
    input: unknown,
  ): Promise<ShiplinkSettlementPostReport> {
    if (!Array.isArray(input)) {
      throw new BadRequestException(
        'Request body must be the generated settlement JSON array.',
      );
    }
    if (input.length === 0) {
      throw new BadRequestException(
        'Request body must contain at least one settlement line.',
      );
    }
    const payloads = input.map((value, index) =>
      this.normalizeUploadedPayload(value, index),
    );
    return this.postPayloads(payloads);
  }

  /**
   * Build settlement bodies from the enhanced Shiplink workbook and the
   * Shiplink cash-in/invoice workbook, then post them through
   * PaymentJournalLineSettledInvoices. Open-invoice due dates are still
   * resolved from Finance before each write.
   */
  public async settleFromExcelFiles(
    enhancedRecords: Buffer,
    invoiceFile: Buffer,
    options?: { journalBatchNumber?: string; dryRun?: boolean },
  ): Promise<ShiplinkSettlementExcelReport> {
    const enhancedRows = await this.readExcelRows(
      enhancedRecords,
      'Enhanced_source',
    );
    const invoiceRows = await this.readExcelRows(invoiceFile);
    const invoiceIndex = this.buildInvoiceFileIndex(invoiceRows);
    const { payloads, skipped, sourceRowCount } =
      this.buildPayloadsFromEnhancedRows(
        enhancedRows,
        invoiceIndex,
        options?.journalBatchNumber,
      );
    if (payloads.length === 0) {
      const reasons = [
        ...new Set(skipped.map((row) => row.reason)),
      ].join(', ');
      throw new BadRequestException(
        `No Shiplink settlement lines were produced from the Excel files. Skipped ${skipped.length} row(s)${reasons ? `: ${reasons}` : '.'}`,
      );
    }

    const skippedCount = skipped.length;
    const missingDueDateCount = skipped.filter(
      (row) => row.reason === 'MISSING_INVOICE_DUE_DATE',
    ).length;
    if (options?.dryRun) {
      return {
        journalBatchNumber: payloads[0].JournalBatchNumber,
        company: payloads[0].JournalLineCompany,
        requestedCount: payloads.length,
        postedCount: 0,
        alreadySettledCount: 0,
        amountMismatchCount: 0,
        failedCount: 0,
        posted: [],
        alreadySettled: [],
        amountMismatches: [],
        failures: [],
        dryRun: true,
        sourceRowCount,
        skippedCount,
        missingDueDateCount,
        skipped,
        payloads,
      };
    }

    const report = await this.postPayloads(payloads);
    return {
      ...report,
      dryRun: false,
      sourceRowCount,
      skippedCount,
      missingDueDateCount,
      skipped,
    };
  }

  private async postPayloads(
    payloads: ShiplinkSettlementPayload[],
  ): Promise<ShiplinkSettlementPostReport> {
    const existing = await this.loadExistingSettlements(payloads);
    const posted: ShiplinkSettlementPayload[] = [];
    const alreadySettled: ShiplinkSettlementPayload[] = [];
    const amountMismatches: ShiplinkSettlementPostReport['amountMismatches'] =
      [];
    const failures: ShiplinkSettlementPostReport['failures'] = [];
    const invoiceCache = new Map<string, CustomerTransaction[]>();
    const consumedByInvoice = new Map<string, number>();

    for (const payload of payloads) {
      const matches = existing.filter((row) =>
        this.sameSettlementIdentity(row, payload),
      );
      const exact = matches.find((row) =>
        this.moneyEquals(
          row.SettlementAmountInInvoiceCurrency,
          payload.SettlementAmountInInvoiceCurrency,
        ),
      );
      if (exact) {
        alreadySettled.push(payload);
        continue;
      }
      if (matches.length > 0) {
        amountMismatches.push({ expected: payload, actual: matches[0] });
        continue;
      }

      const financePayload = await this.withOpenInvoiceDueDate(
        payload,
        invoiceCache,
        consumedByInvoice,
      );

      try {
        await this.d365.post<ShiplinkSettlementPayload, unknown>(
          '/data/PaymentJournalLineSettledInvoices',
          financePayload,
          { retries: 0 },
        );
        posted.push(financePayload);
      } catch (error) {
        // A D365 OData create may return an ambiguous transport/RecId error
        // after the row was committed. Verify before reporting a real failure.
        const recovered = await this.loadExistingSettlements([financePayload]);
        const recoveredExact = recovered.find(
          (row) =>
            this.sameSettlementIdentity(row, financePayload) &&
            this.moneyEquals(
              row.SettlementAmountInInvoiceCurrency,
              financePayload.SettlementAmountInInvoiceCurrency,
            ),
        );
        if (recoveredExact) {
          alreadySettled.push(financePayload);
        } else {
          failures.push({
            payload: financePayload,
            error: this.errorMessage(error),
          });
        }
      }
    }

    const company = payloads[0].JournalLineCompany;
    return {
      journalBatchNumber: payloads[0].JournalBatchNumber,
      company,
      requestedCount: payloads.length,
      postedCount: posted.length,
      alreadySettledCount: alreadySettled.length,
      amountMismatchCount: amountMismatches.length,
      failedCount: failures.length,
      posted,
      alreadySettled,
      amountMismatches,
      failures,
    };
  }

  public async getDifferenceReport(
    batchId: string,
  ): Promise<ShiplinkSettlementDifferenceReport> {
    const batch = await this.batches.getByIdAsync(batchId);
    if (!batch)
      throw new NotFoundException(`Data batch ${batchId} was not found`);
    const expected = await this.export(batchId);
    const existing = await this.loadExistingSettlements(expected);
    const lines = await this.loadFinanceLines(batch.company, [
      ...new Set(expected.map((payload) => payload.JournalBatchNumber)),
    ]);
    const expectedWithVoucher = expected.map((payload) => ({
      ...payload,
      voucher: this.asText(
        lines.get(
          this.financeLineKey(
            payload.JournalBatchNumber,
            payload.JournalLineNumber,
          ),
        )?.Voucher,
      ),
    }));
    const usedExisting = new Set<number>();
    const settled: Array<ShiplinkSettlementPayload & { voucher: string }> = [];
    const notSettled: Array<ShiplinkSettlementPayload & { voucher: string }> =
      [];
    const amountMismatches: ShiplinkSettlementDifferenceReport['amountMismatches'] =
      [];

    for (const payload of expectedWithVoucher) {
      const matches = existing
        .map((row, index) => ({ row, index }))
        .filter(
          ({ row }) =>
            this.asText(row.JournalLineCompany).toLowerCase() ===
              payload.JournalLineCompany.toLowerCase() &&
            this.asText(row.JournalBatchNumber).toLowerCase() ===
              payload.JournalBatchNumber.toLowerCase() &&
            Number(row.JournalLineNumber) === payload.JournalLineNumber &&
            this.asText(row.InvoiceNumber).toLowerCase() ===
              payload.InvoiceNumber.toLowerCase() &&
            this.asText(row.InvoiceCompany).toLowerCase() ===
              payload.InvoiceCompany.toLowerCase(),
        );
      const exact = matches.find(({ row }) =>
        this.moneyEquals(
          row.SettlementAmountInInvoiceCurrency,
          payload.SettlementAmountInInvoiceCurrency,
        ),
      );
      if (exact) {
        usedExisting.add(exact.index);
        settled.push(payload);
      } else if (matches.length > 0) {
        usedExisting.add(matches[0].index);
        amountMismatches.push({ expected: payload, actual: matches[0].row });
      } else {
        notSettled.push(payload);
      }
    }

    const extraSettlements = existing.filter(
      (_, index) => !usedExisting.has(index),
    );
    const expectedAmount = this.roundMoney(
      expected.reduce(
        (sum, payload) => sum + payload.SettlementAmountInInvoiceCurrency,
        0,
      ),
    );
    const settledAmount = this.roundMoney(
      settled.reduce(
        (sum, payload) => sum + payload.SettlementAmountInInvoiceCurrency,
        0,
      ),
    );
    return {
      batchId,
      company: batch.company,
      expectedCount: expected.length,
      settledCount: settled.length,
      notSettledCount: notSettled.length,
      amountMismatchCount: amountMismatches.length,
      extraSettlementCount: extraSettlements.length,
      expectedAmount,
      settledAmount,
      differenceAmount: this.roundMoney(expectedAmount - settledAmount),
      settled,
      notSettled,
      amountMismatches,
      extraSettlements,
    };
  }

  public async getUnsettledLines(
    batchId: string,
  ): Promise<ShiplinkUnsettledLinesReport> {
    const batch = await this.batches.getByIdAsync(batchId);
    if (!batch)
      throw new NotFoundException(`Data batch ${batchId} was not found`);
    const difference = await this.getDifferenceReport(batchId);
    const mismatched = new Map(
      difference.amountMismatches.map((item) => [
        this.settlementKey(item.expected),
        item.expected,
      ]),
    );
    const remainingLines = [
      ...difference.notSettled.map((payload) => ({
        ...payload,
        status: 'NOT_SETTLED' as const,
      })),
      ...[...mismatched.values()].map((payload) => ({
        ...payload,
        status: 'AMOUNT_MISMATCH' as const,
      })),
    ];
    const financeLines = await this.loadFinanceLines(batch.company, [
      ...new Set(remainingLines.map((payload) => payload.JournalBatchNumber)),
    ]);
    const expectedLineKeys = new Set(
      [
        ...difference.settled,
        ...difference.notSettled,
        ...difference.amountMismatches.map((item) => item.expected),
      ].map((payload) =>
        this.financeLineKey(
          payload.JournalBatchNumber,
          payload.JournalLineNumber,
        ),
      ),
    );
    const unmatchedFinanceLines = [...financeLines.entries()]
      .filter(([key]) => !expectedLineKeys.has(key))
      .map(([, line]) => line);
    return {
      batchId,
      company: batch.company,
      remainingLines,
      unmatchedFinanceLines,
    };
  }

  private toSourceRow(
    data: Record<string, unknown>,
    company: string,
    excelRow: number,
  ): SettlementSourceRow | undefined {
    const accountType = this.asText(
      data.AccountType || data.ACCOUNTTYPE,
    ).toLowerCase();
    if (accountType && !['cust', 'customer'].includes(accountType))
      return undefined;

    const invoiceNumber = this.asText(
      data.Invoice || data.MarkedInvoice || data.INVOICE || data.MARKEDINVOICE,
    );
    const customerAccount = this.asText(
      data.AccountDisplayValue || data.ACCOUNTDISPLAYVALUE || data.AccountNum,
    )
      .split('|')[0]
      .trim();
    const plannedBatch = this.asText(
      data.JournalBatchNumber || data.JOURNALBATCHNUMBER,
    );
    const lineNumber = Number(data.LineNumber ?? data.LINENUMBER);
    const creditAmount = this.asNumber(data.CreditAmount ?? data.CREDITAMOUNT);
    const debitAmount = this.asNumber(data.DebitAmount ?? data.DEBITAMOUNT);
    if (
      !invoiceNumber ||
      !customerAccount ||
      !plannedBatch ||
      !(lineNumber > 0)
    )
      return undefined;
    if (creditAmount <= 0 || debitAmount > MONEY_TOLERANCE) return undefined;

    return {
      plannedBatch,
      lineNumber,
      company,
      customerAccount,
      invoiceNumber,
      paymentAmount: this.roundMoney(creditAmount - debitAmount),
      paymentCurrency: this.asText(
        data.CurrencyCode || data.CURRENCYCODE,
      ).toUpperCase(),
      paymentExchangeRate: this.asNumber(
        data.ExchangeRate ?? data.EXCHANGERATE,
      ),
      excelRow,
    };
  }

  private async loadFinanceLines(
    company: string,
    batches: string[],
  ): Promise<Map<string, FinanceJournalLine>> {
    const result = new Map<string, FinanceJournalLine>();
    for (const batch of batches) {
      const endpoint = this.query.buildQuery(
        '/data/CustomerPaymentJournalLines',
        {
          crossCompany: true,
          top: 5000,
          select: ['JournalBatchNumber', 'LineNumber', 'Voucher'],
          filter: this.query.and(
            this.query.eq('dataAreaId', company),
            this.query.eq('JournalBatchNumber', batch),
          ),
        },
      );
      const response = await this.d365.get<FinanceJournalLine>(endpoint, {
        useCache: false,
      });
      for (const line of response.value ?? []) {
        const lineNumber = Number(line.LineNumber);
        if (Number.isInteger(lineNumber) && lineNumber > 0) {
          result.set(this.financeLineKey(batch, lineNumber), line);
        }
      }
    }
    return result;
  }

  private async loadExistingSettlements(
    payloads: ShiplinkSettlementPayload[],
  ): Promise<ExistingSettlementRow[]> {
    const result: ExistingSettlementRow[] = [];
    const groups = new Map<string, string>();
    for (const payload of payloads) {
      groups.set(
        `${payload.JournalLineCompany}|${payload.JournalBatchNumber}`,
        payload.JournalBatchNumber,
      );
    }
    for (const [key, batch] of groups) {
      const company = key.split('|')[0];
      const endpoint = this.query.buildQuery(
        '/data/PaymentJournalLineSettledInvoices',
        {
          crossCompany: true,
          top: 5000,
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
            this.query.eq('JournalLineCompany', company),
            this.query.eq('JournalBatchNumber', batch),
          ),
        },
      );
      const response = await this.d365.get<ExistingSettlementRow>(endpoint, {
        useCache: false,
      });
      result.push(...(response.value ?? []));
    }
    return result;
  }

  private async findInvoiceTransaction(
    row: SettlementSourceRow,
  ): Promise<CustomerTransaction> {
    const endpoint = this.query.buildQuery('/data/CustTransBiEntities', {
      crossCompany: true,
      top: 50,
      select: [
        'Invoice',
        'AccountNum',
        'CurrencyCode',
        'AmountCur',
        'AmountMST',
        'SettleAmountCur',
        'RemainAmountCur',
        'DueDate',
        'TransDate',
      ],
      filter: this.query.and(
        this.query.eq('dataAreaId', row.company),
        this.query.eq('AccountNum', row.customerAccount),
        this.query.eq('Invoice', row.invoiceNumber),
      ),
    });
    const response = await this.d365.get<CustomerTransaction>(endpoint, {
      useCache: false,
    });
    const candidates = response.value.filter((transaction) =>
      this.asText(transaction.DueDate),
    );
    if (candidates.length === 0) {
      throw new Error(
        `No Finance transaction with a due date was found for invoice ${row.invoiceNumber}.`,
      );
    }
    return [...candidates].sort((left, right) => {
      const leftCurrency =
        this.asText(left.CurrencyCode).toUpperCase() === row.paymentCurrency
          ? 0
          : 1;
      const rightCurrency =
        this.asText(right.CurrencyCode).toUpperCase() === row.paymentCurrency
          ? 0
          : 1;
      if (leftCurrency !== rightCurrency) return leftCurrency - rightCurrency;
      return this.remainingAmount(right) - this.remainingAmount(left);
    })[0];
  }

  private convertToInvoiceCurrency(
    transaction: CustomerTransaction,
    row: SettlementSourceRow,
  ): number {
    const invoiceCurrency = this.asText(transaction.CurrencyCode).toUpperCase();
    if (
      !row.paymentCurrency ||
      !invoiceCurrency ||
      row.paymentCurrency === invoiceCurrency
    ) {
      return row.paymentAmount;
    }
    const paymentRate = row.paymentExchangeRate / 100;
    const invoiceAmount = Math.abs(this.asNumber(transaction.AmountCur));
    const invoiceAmountMst = Math.abs(this.asNumber(transaction.AmountMST));
    const invoiceRate =
      invoiceAmount > MONEY_TOLERANCE ? invoiceAmountMst / invoiceAmount : 0;
    if (!(paymentRate > 0) || !(invoiceRate > 0)) return 0;
    return this.roundMoney((row.paymentAmount * paymentRate) / invoiceRate);
  }

  private remainingAmount(transaction: CustomerTransaction): number {
    const explicit = Number(transaction.RemainAmountCur);
    if (Number.isFinite(explicit) && explicit !== 0) return Math.abs(explicit);
    return Math.max(
      0,
      Math.abs(this.asNumber(transaction.AmountCur)) -
        Math.abs(this.asNumber(transaction.SettleAmountCur)),
    );
  }

  /**
   * PaymentJournalLineSettledInvoices looks up CustTransOpen by invoice +
   * due date. Generated JSON often carries the payment TransDate at midnight
   * UTC; replace it with the open invoice DueDate Finance actually stores.
   */
  private async withOpenInvoiceDueDate(
    payload: ShiplinkSettlementPayload,
    invoiceCache: Map<string, CustomerTransaction[]>,
    consumedByInvoice: Map<string, number>,
  ): Promise<ShiplinkSettlementPayload> {
    const openInvoices = await this.loadOpenInvoiceTransactions(
      payload,
      invoiceCache,
    );
    const picked = this.pickOpenInvoiceTransaction(
      openInvoices,
      payload,
      consumedByInvoice,
    );
    if (!picked) return payload;
    const invoiceKey = this.invoiceCacheKey(payload);
    consumedByInvoice.set(
      invoiceKey,
      (consumedByInvoice.get(invoiceKey) ?? 0) +
        payload.SettlementAmountInInvoiceCurrency,
    );
    const dueDate = this.asText(picked.DueDate);
    if (!dueDate) return payload;
    return { ...payload, InvoiceDueDate: dueDate };
  }

  private async loadOpenInvoiceTransactions(
    payload: ShiplinkSettlementPayload,
    invoiceCache: Map<string, CustomerTransaction[]>,
  ): Promise<CustomerTransaction[]> {
    const cacheKey = this.invoiceCacheKey(payload);
    const cached = invoiceCache.get(cacheKey);
    if (cached) return cached;

    const endpoint = this.query.buildQuery('/data/CustTransBiEntities', {
      crossCompany: true,
      top: 50,
      select: [
        'Invoice',
        'DueDate',
        'Closed',
        'AmountCur',
        'AmountMST',
        'SettleAmountCur',
        'RemainAmountCur',
      ],
      filter: this.query.and(
        this.query.eq('dataAreaId', payload.InvoiceCompany),
        this.query.eq('Invoice', payload.InvoiceNumber),
      ),
    });
    const response = await this.d365.get<CustomerTransaction>(endpoint, {
      useCache: false,
    });
    const openInvoices = (response.value ?? []).filter((row) => {
      if (!this.asText(row.DueDate)) return false;
      if (this.readClosedState(row.Closed) === true) return false;
      return this.remainingAmount(row) > MONEY_TOLERANCE;
    });
    invoiceCache.set(cacheKey, openInvoices);
    return openInvoices;
  }

  private pickOpenInvoiceTransaction(
    openInvoices: CustomerTransaction[],
    payload: ShiplinkSettlementPayload,
    consumedByInvoice: Map<string, number>,
  ): CustomerTransaction | undefined {
    const consumed = consumedByInvoice.get(this.invoiceCacheKey(payload)) ?? 0;
    const candidates = openInvoices.filter(
      (row) => this.remainingAmount(row) - consumed > MONEY_TOLERANCE,
    );
    const pool = candidates.length > 0 ? candidates : openInvoices;
    if (pool.length === 0) return undefined;
    const dateMatched = pool.filter(
      (row) => this.dateKey(row.DueDate) === this.dateKey(payload.InvoiceDueDate),
    );
    const ranked = dateMatched.length > 0 ? dateMatched : pool;
    return [...ranked].sort((left, right) => {
      const leftGap = Math.abs(
        this.remainingAmount(left) - payload.SettlementAmountInInvoiceCurrency,
      );
      const rightGap = Math.abs(
        this.remainingAmount(right) - payload.SettlementAmountInInvoiceCurrency,
      );
      return leftGap - rightGap;
    })[0];
  }

  private invoiceCacheKey(payload: ShiplinkSettlementPayload): string {
    return `${payload.InvoiceCompany}|${payload.InvoiceNumber}`.toLowerCase();
  }

  private dateKey(value: unknown): string {
    const match = this.asText(value).match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
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

  private financeLineKey(batch: string, lineNumber: number): string {
    return `${batch.trim().toLowerCase()}|${lineNumber}`;
  }

  private settlementKey(payload: ShiplinkSettlementPayload): string {
    return [
      payload.JournalLineCompany,
      payload.JournalBatchNumber,
      payload.JournalLineNumber,
      payload.InvoiceNumber,
      payload.InvoiceCompany,
    ]
      .map((value) => String(value).trim().toLowerCase())
      .join('|');
  }

  private sameSettlementIdentity(
    row: ExistingSettlementRow,
    payload: ShiplinkSettlementPayload,
  ): boolean {
    return (
      this.asText(row.JournalLineCompany).toLowerCase() ===
        payload.JournalLineCompany.toLowerCase() &&
      this.asText(row.JournalBatchNumber).toLowerCase() ===
        payload.JournalBatchNumber.toLowerCase() &&
      Number(row.JournalLineNumber) === payload.JournalLineNumber &&
      this.asText(row.InvoiceNumber).toLowerCase() ===
        payload.InvoiceNumber.toLowerCase() &&
      this.asText(row.InvoiceCompany).toLowerCase() ===
        payload.InvoiceCompany.toLowerCase()
    );
  }

  private moneyEquals(left: unknown, right: unknown): boolean {
    return (
      Math.abs(this.asNumber(left) - this.asNumber(right)) <= MONEY_TOLERANCE
    );
  }

  private async readExcelRows(
    buffer: Buffer,
    preferredSheetName?: string,
  ): Promise<Record<string, unknown>[]> {
    if (!buffer?.length) {
      throw new BadRequestException('Excel file is empty or missing.');
    }
    if (preferredSheetName) {
      try {
        const named = await this.excel.excelToSheetData<Record<string, unknown>>(
          buffer,
          preferredSheetName,
        );
        if (named.rows.length > 0) return named.rows;
      } catch (error) {
        if (
          !(error instanceof BadRequestException) ||
          !this.errorMessage(error).includes('was not found')
        ) {
          throw error;
        }
      }
    }
    return this.excel.excelToJson<Record<string, unknown>>(buffer);
  }

  private buildInvoiceFileIndex(
    rows: Record<string, unknown>[],
  ): InvoiceFileIndex {
    const uniqueIds = new Set<string>();
    const invoices = new Set<string>();
    const amountKeys = new Set<string>();
    const dueDatesByUniqueId = new Map<string, string[]>();
    const dueDatesByInvoice = new Map<string, string[]>();
    for (const row of rows) {
      if (!this.hasAnyValue(row)) continue;
      const uniqueId = this.cellText(this.field(row, UNIQUE_ID_COLUMNS));
      const invoice = this.cellText(this.field(row, INVOICE_ID_COLUMNS));
      const credit = this.roundMoney(
        this.safeNumber(
          this.unwrapCell(this.field(row, ['CreditAmount', 'CREDITAMOUNT']) ?? 0),
        ),
      );
      const dueDate =
        this.financeDueDate(this.field(row, DUE_DATE_COLUMNS)) ||
        this.financeDueDate(this.field(row, PAYMENT_DATE_COLUMNS));
      if (uniqueId) uniqueIds.add(uniqueId);
      if (invoice) invoices.add(invoice.toLowerCase());
      if (invoice && credit > 0) {
        amountKeys.add(`${invoice.toLowerCase()}|${credit}`);
      }
      if (uniqueId && dueDate) {
        this.pushDueDate(dueDatesByUniqueId, uniqueId, dueDate);
      }
      if (invoice && dueDate) {
        this.pushDueDate(dueDatesByInvoice, invoice.toLowerCase(), dueDate);
      }
    }
    return { uniqueIds, invoices, amountKeys, dueDatesByUniqueId, dueDatesByInvoice };
  }

  private pushDueDate(
    lookup: Map<string, string[]>,
    key: string,
    dueDate: string,
  ): void {
    const current = lookup.get(key) ?? [];
    if (!current.includes(dueDate)) current.push(dueDate);
    lookup.set(key, current);
  }

  private takeDueDate(lookup: Map<string, string[]>, key: string): string {
    const dates = lookup.get(key) ?? [];
    if (dates.length === 0) return '';
    const dueDate = dates[0];
    if (dates.length > 1) dates.shift();
    return dueDate;
  }

  private buildPayloadsFromEnhancedRows(
    rows: Record<string, unknown>[],
    invoiceIndex: InvoiceFileIndex,
    journalBatchNumber?: string,
  ): {
    payloads: ShiplinkSettlementPayload[];
    skipped: ShiplinkSettlementExcelSkip[];
    sourceRowCount: number;
  } {
    const journalFilter = this.asText(journalBatchNumber);
    const payloads: ShiplinkSettlementPayload[] = [];
    const skipped: ShiplinkSettlementExcelSkip[] = [];
    let sourceRowCount = 0;

    for (const [index, row] of rows.entries()) {
      const excelRow = index + 2;
      if (!this.hasAnyValue(row)) continue;
      sourceRowCount += 1;

      const method = this.cellText(
        this.field(row, [
          'Settlement Methode',
          'SettlementMethod',
          'SettlementIntent',
        ]),
      ).toLowerCase();
      const status = this.cellText(this.field(row, ['Status'])).toLowerCase();
      const accountType = this.cellText(
        this.field(row, ['AccountType', 'ACCOUNTTYPE']),
      ).toLowerCase();
      const account = this.cellText(
        this.field(row, ['AccountDisplayValue', 'ACCOUNTDISPLAYVALUE']),
      );
      const invoice = this.cellText(
        this.field(row, ['Invoice', 'INVOICE', 'MarkedInvoice']),
      );
      const uniqueId = this.cellText(this.field(row, UNIQUE_ID_COLUMNS));
      const batch = this.cellText(
        this.field(row, ['JournalBatchNumber', 'JOURNALBATCHNUMBER']),
      );
      const company =
        this.cellText(
          this.field(row, ['Company', 'dataAreaId', 'JournalLineCompany']),
        ) || DEFAULT_COMPANY;
      const credit = this.safeNumber(
        this.unwrapCell(this.field(row, ['CreditAmount', 'CREDITAMOUNT']) ?? 0),
      );
      const lineNumber = this.safeNumber(
        this.unwrapCell(
          this.field(row, ['LineNumber', 'LINENUMBER', 'SourceLineNumber']) ?? 0,
        ),
      );

      if (accountType === 'ledger' && account.startsWith('524529')) {
        skipped.push({
          excelRow,
          invoice,
          journalBatchNumber: batch,
          reason: 'SKIPPED_LEDGER_VARIANCE',
        });
        continue;
      }
      if (SKIP_STATUSES.has(status) || SKIP_SETTLEMENT_METHODS.has(method)) {
        skipped.push({
          excelRow,
          invoice,
          journalBatchNumber: batch,
          reason: 'SKIPPED_NO_SETTLEMENT',
        });
        continue;
      }
      if (
        invoiceIndex.uniqueIds.size > 0 &&
        uniqueId &&
        !invoiceIndex.uniqueIds.has(uniqueId)
      ) {
        skipped.push({
          excelRow,
          invoice,
          journalBatchNumber: batch,
          reason: 'NOT_IN_INVOICE_FILE',
        });
        continue;
      }
      const amountKey =
        invoice && credit > 0 ? `${invoice.toLowerCase()}|${this.roundMoney(credit)}` : '';
      if (
        !(invoiceIndex.uniqueIds.size > 0 && uniqueId) &&
        invoiceIndex.amountKeys.size > 0 &&
        amountKey &&
        !invoiceIndex.amountKeys.has(amountKey)
      ) {
        skipped.push({
          excelRow,
          invoice,
          journalBatchNumber: batch,
          reason: 'NOT_IN_INVOICE_FILE',
        });
        continue;
      }
      if (
        !(invoiceIndex.uniqueIds.size > 0 && uniqueId) &&
        invoiceIndex.amountKeys.size === 0 &&
        invoiceIndex.invoices.size > 0 &&
        invoice &&
        !invoiceIndex.invoices.has(invoice.toLowerCase())
      ) {
        skipped.push({
          excelRow,
          invoice,
          journalBatchNumber: batch,
          reason: 'NOT_IN_INVOICE_FILE',
        });
        continue;
      }
      if (journalFilter && batch.toLowerCase() !== journalFilter.toLowerCase()) {
        continue;
      }
      if (!invoice) {
        skipped.push({
          excelRow,
          invoice,
          journalBatchNumber: batch,
          reason: 'MISSING_INVOICE',
        });
        continue;
      }
      if (!batch) {
        skipped.push({
          excelRow,
          invoice,
          journalBatchNumber: batch,
          reason: 'MISSING_JOURNAL_BATCH',
        });
        continue;
      }
      if (!(lineNumber > 0)) {
        skipped.push({
          excelRow,
          invoice,
          journalBatchNumber: batch,
          reason: 'MISSING_LINE_NUMBER',
        });
        continue;
      }
      if (!(credit > 0)) {
        skipped.push({
          excelRow,
          invoice,
          journalBatchNumber: batch,
          reason: 'ZERO_AMOUNT',
        });
        continue;
      }

      let dueDate = this.financeDueDate(this.field(row, DUE_DATE_COLUMNS));
      if (!dueDate && uniqueId) {
        dueDate = this.takeDueDate(invoiceIndex.dueDatesByUniqueId, uniqueId);
      }
      if (!dueDate) {
        dueDate = this.takeDueDate(
          invoiceIndex.dueDatesByInvoice,
          invoice.toLowerCase(),
        );
      }
      if (!dueDate) {
        dueDate = this.financeDueDate(this.field(row, PAYMENT_DATE_COLUMNS));
      }
      if (!dueDate) {
        skipped.push({
          excelRow,
          invoice,
          journalBatchNumber: batch,
          reason: 'MISSING_INVOICE_DUE_DATE',
        });
        continue;
      }

      payloads.push({
        JournalLineCompany: company,
        JournalBatchNumber: batch,
        JournalLineNumber: lineNumber,
        InvoiceNumber: invoice,
        InvoiceCompany: company,
        InvoiceDueDate: dueDate,
        SettlementAmountInInvoiceCurrency: this.roundMoney(credit),
      });
    }

    return { payloads, skipped, sourceRowCount };
  }

  private field(row: Record<string, unknown>, names: string[]): unknown {
    const keys = Object.keys(row);
    for (const name of names) {
      const match = keys.find(
        (key) => this.normalizeHeader(key) === this.normalizeHeader(name),
      );
      if (!match) continue;
      const value = this.unwrapCell(row[match]);
      if (value === undefined || value === null) continue;
      if (this.cellText(value) === '' && typeof value !== 'number') continue;
      return value;
    }
    return undefined;
  }

  private hasAnyValue(row: Record<string, unknown>): boolean {
    return Object.values(row).some((value) => {
      const unwrapped = this.unwrapCell(value);
      if (typeof unwrapped === 'number' && Number.isFinite(unwrapped))
        return true;
      return this.cellText(unwrapped) !== '';
    });
  }

  private unwrapCell(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return value;
    if (value instanceof Date) return value;
    const cell = value as {
      result?: unknown;
      text?: unknown;
      richText?: Array<{ text?: string }>;
    };
    if (cell.result !== undefined) return this.unwrapCell(cell.result);
    if (typeof cell.text === 'string') return cell.text;
    if (Array.isArray(cell.richText)) {
      return cell.richText.map((part) => part.text ?? '').join('');
    }
    return value;
  }

  private cellText(value: unknown): string {
    const unwrapped = this.unwrapCell(value);
    if (unwrapped instanceof Date) return this.financeDueDate(unwrapped);
    return this.asText(unwrapped);
  }

  private financeDueDate(value: unknown): string {
    const unwrapped = this.unwrapCell(value);
    if (unwrapped instanceof Date && !Number.isNaN(unwrapped.getTime())) {
      const year = unwrapped.getUTCFullYear();
      const month = String(unwrapped.getUTCMonth() + 1).padStart(2, '0');
      const day = String(unwrapped.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}T12:00:00Z`;
    }

    const text = this.asText(unwrapped);
    if (!text) return '';

    const isoMatch = text.match(
      /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})?/,
    );
    if (isoMatch) return `${isoMatch[1]}T12:00:00Z`;

    const dayFirst = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dayFirst) {
      const day = dayFirst[1].padStart(2, '0');
      const month = dayFirst[2].padStart(2, '0');
      const year = dayFirst[3];
      return `${year}-${month}-${day}T12:00:00Z`;
    }

    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric >= 20000 && numeric <= 80000) {
      const parsed = new Date(
        Date.UTC(1899, 11, 30) + Math.round(numeric) * 86400000,
      );
      if (!Number.isNaN(parsed.getTime())) {
        return this.financeDueDate(parsed);
      }
    }

    const timestamp = Date.parse(text);
    if (!Number.isFinite(timestamp)) return '';
    return this.financeDueDate(new Date(timestamp));
  }

  private normalizeHeader(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private safeNumber(value: unknown): number {
    if (value === undefined || value === null || this.cellText(value) === '')
      return 0;
    const result = Number(this.unwrapCell(value));
    return Number.isFinite(result) ? result : 0;
  }

  private asText(value: unknown): string {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    )
      return String(value).trim();
    return '';
  }

  private asNumber(value: unknown): number {
    if (value === undefined || value === null || this.asText(value) === '')
      return 0;
    const result = Number(value);
    if (!Number.isFinite(result))
      throw new BadRequestException(
        `Invalid numeric value: ${this.asText(value)}.`,
      );
    return result;
  }

  private normalizeUploadedPayload(
    value: unknown,
    index: number,
  ): ShiplinkSettlementPayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(
        `SettlementLines row ${index + 1} must be an object.`,
      );
    }
    const row = value as Record<string, unknown>;
    const company = this.asText(row.JournalLineCompany);
    const batch = this.asText(row.JournalBatchNumber);
    const invoice = this.asText(row.InvoiceNumber);
    const invoiceCompany = this.asText(row.InvoiceCompany);
    const lineNumber = this.asNumber(row.JournalLineNumber);
    const amount = this.asNumber(row.SettlementAmountInInvoiceCurrency);
    const dueDate = this.asText(row.InvoiceDueDate);
    const missing = [
      !company && 'JournalLineCompany',
      !batch && 'JournalBatchNumber',
      !(lineNumber > 0) && 'JournalLineNumber',
      !invoice && 'InvoiceNumber',
      !invoiceCompany && 'InvoiceCompany',
      !dueDate && 'InvoiceDueDate',
      !Number.isFinite(amount) && 'SettlementAmountInInvoiceCurrency',
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new BadRequestException(
        `SettlementLines row ${index + 1} is missing or invalid: ${missing.join(', ')}.`,
      );
    }
    return {
      JournalLineCompany: company,
      JournalBatchNumber: batch,
      JournalLineNumber: lineNumber,
      InvoiceNumber: invoice,
      InvoiceCompany: invoiceCompany,
      InvoiceDueDate: dueDate,
      SettlementAmountInInvoiceCurrency: amount,
    };
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
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
