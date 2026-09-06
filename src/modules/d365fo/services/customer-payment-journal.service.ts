import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { D365FOClientService } from './d365fo-client.service';
import { DfoErrorExtractorService } from './dfo-error-extractor.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';
import {
  VendorInvoiceJournalService,
  VendorPaymentJournalSettlementTarget,
  VendorPaymentSettlementVerification,
} from './vendor-invoice-journal.service';
import { VendorPaymentJournalService } from './vendor-payment-journal.service';

import { IConfig, ResilienceConfig } from '@/config';
import { NonRetryableDfoPostingError } from '@/modules/d365fo/errors/non-retryable-dfo-posting.error';
import {
  D365FOCustomerPaymentJournalHeaderRequest,
  D365FOCustomerPaymentJournalHeaderResponse,
  D365FOCustomerPaymentJournalLineRequest,
} from '@/modules/d365fo/types';
import {
  TSLedgerJournalTransCustomBulkLineResponseBody,
  TSLedgerJournalTransCustomBulkLineRequestBody,
  TSLedgerJournalTransCustomBulkRequest,
  TSLedgerJournalTransCustomBulkResponseBody,
  TSLedgerJournalTransCustomRequest,
  TSLedgerJournalTransCustomRequestBody,
  TSLedgerJournalTransCustomResponseBody,
} from '@/modules/d365fo/types/d365fo-cash-custom-ledger-journal.type';
import { LogPayloadService } from '@/modules/observability/services/log-payload.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { RetryService } from '@/modules/resilience/services/retry.service';
import {
  createCustodySettlementSkipRow,
  CustodySettlementSkipPhase,
  CustodySettlementSkipRow,
  isAlreadyMarkedUnmarkedUploadSkip,
} from '@/modules/cash/services/custody-settlement-skip-report';

export type CashJournalExistingLinesLoader = () => Promise<
  Array<{ LineNumber: number }>
>;

interface CashBulkPendingLine {
  lineNumber: number;
  sourceLineNumber?: number;
  groupInvoice?: string;
  body: TSLedgerJournalTransCustomRequestBody;
}

interface CashBulkLineFailure {
  requestIndex: number;
  lineNumber?: number;
  message: string;
  correlated: boolean;
}

type CashBulkAttempt = 'initial' | 'unmarked_retry';

/** Position of one request within the journal batch it belongs to. */
interface CashBulkBatch {
  number: number;
  total: number;
}

interface CashOutBulkBatchResult {
  unmarkedSettlements: VendorPaymentJournalSettlementTarget[];
  settlementSkip?: CustodySettlementSkipRow;
}

/**
 * Service for managing customer payment journals in D365FO
 * (CustomerPaymentJournalHeaders / CustomerPaymentJournalLines)
 */
@Injectable()
export class CustomerPaymentJournalService {
  private readonly logger = new Logger(CustomerPaymentJournalService.name);

  /**
   * Custom cash line posting endpoints.
   * These are NOT OData entity POSTs; they are X++ service entry points.
   */
  private readonly cashInLineEndpoint =
    '/api/services/TSLedgerJournalServiceGroup/ServiceBasic/addLedgerJournalTransCustPaym';
  private readonly cashOutLineEndpoint =
    '/api/services/TSLedgerJournalServiceGroup/ServiceBasic/addLedgerJournalTransVendPaym';

  /** Maximum lines per Cash-In custom-service request. Cash-Out sends each UniqueId in full. */
  private readonly cashOutBulkBatchSize = 100;

  /** Axios timeout for cash-out bulk custom-service POSTs (see D365FO_BULK_HTTP_TIMEOUT). */
  private readonly cashOutBulkHttpTimeout: number;

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
    private readonly retryService: RetryService,
    private readonly dfoErrorExtractor: DfoErrorExtractorService,
    private readonly vendorPaymentJournalService: VendorPaymentJournalService,
    private readonly vendorInvoiceJournalService: VendorInvoiceJournalService,
    private readonly operationalLogs: OperationalLoggerService,
    private readonly logPayloads: LogPayloadService,
    configService: ConfigService<IConfig>,
  ) {
    this.cashOutBulkHttpTimeout =
      configService.get<ResilienceConfig>('resilience')?.bulkHttpTimeout ??
      600_000;
  }

  /**
   * Post customer payment journal header to D365FO (single header)
   */
  public async postHeader(
    data: D365FOCustomerPaymentJournalHeaderRequest,
  ): Promise<D365FOCustomerPaymentJournalHeaderResponse> {
    this.logger.log(
      `[HEADER] Creating customer payment header for company: ${data.dataAreaId}`,
    );

    const { JournalBatchNumber: _omit, ...payload } = data;

    return this.d365foClient.post<
      Omit<D365FOCustomerPaymentJournalHeaderRequest, 'JournalBatchNumber'>,
      D365FOCustomerPaymentJournalHeaderResponse
    >('/data/CustomerPaymentJournalHeaders', payload);
  }

  /**
   * Post lines for a specific header (chunked, sequential).
   * Includes idempotency checks to avoid posting duplicate lines.
   */
  public async postLinesForHeader(
    headerKey: string,
    lines: D365FOCustomerPaymentJournalLineRequest[],
    chunkSize: number = 20,
    dataAreaId?: string,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const shapedLines = lines.map((line) => ({
      ...line,
      JournalBatchNumber: headerKey,
    }));

    this.logger.log(
      `[LINES] Posting ${shapedLines.length} customer payment lines for header ${headerKey} in chunks of ${chunkSize}`,
    );

    let existingLines: Set<number> = new Set();
    if (dataAreaId && shapedLines.length > 0) {
      try {
        const existing = await this.listLinesForHeader(headerKey, dataAreaId);
        existingLines = new Set(existing.map((l) => l.LineNumber));
        if (existingLines.size > 0) {
          this.logger.log(
            `[LINES] Found ${existingLines.size} existing lines for header ${headerKey}, will skip duplicates`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `[LINES] Could not query existing lines for header ${headerKey}: ${this.dfoErrorExtractor.extractMessage(
            error,
          )}`,
        );
      }
    }

    const successfullyPosted: Array<{
      headerId: string;
      lineNumber: number;
    }> = [];

    for (let i = 0; i < shapedLines.length; i += chunkSize) {
      const chunk = shapedLines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.log(
        `[LINES] Processing chunk ${chunkNumber}/${totalChunks} for header ${headerKey} (${chunk.length} lines)`,
      );

      for (const line of chunk) {
        if (existingLines.has(line.LineNumber)) {
          successfullyPosted.push({
            headerId: headerKey,
            lineNumber: line.LineNumber,
          });
          continue;
        }

        try {
          await this.postLine(line);
          successfullyPosted.push({
            headerId: headerKey,
            lineNumber: line.LineNumber,
          });
          if (line !== chunk[chunk.length - 1]) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        } catch (error) {
          const errorDetails = this.dfoErrorExtractor.extractMessage(error);
          this.logger.error(
            `[LINES] Failed to post line ${line.LineNumber} for header ${headerKey}: ${errorDetails}`,
            error instanceof Error ? error.stack : undefined,
          );
          throw new Error(
            `Failed to post line ${line.LineNumber} for header ${headerKey}: ${errorDetails}`,
          );
        }
      }
    }

    return successfullyPosted;
  }

  /**
   * Cash-In line posting via addLedgerJournalTransCustPaym (custom API).
   * Keeps the same line idempotency approach used by the OData flow.
   */
  public async postCashInLinesForHeader(
    headerKey: string,
    lines: D365FOCustomerPaymentJournalLineRequest[],
    chunkSize: number = 20,
    dataAreaId?: string,
    existingLinesLoader?: CashJournalExistingLinesLoader,
    allowUnmarkedInvoiceRetry = false,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const result = await this.postCashLinesForHeader(
      headerKey,
      lines,
      chunkSize,
      dataAreaId,
      'in',
      existingLinesLoader,
      allowUnmarkedInvoiceRetry,
      false,
    );
    return result.postedLines;
  }

  /**
   * Cash-Out line posting via addLedgerJournalTransVendPaym (custom API).
   * Keeps the same line idempotency approach used by the OData flow.
   */
  public async postCashOutLinesForHeader(
    headerKey: string,
    lines: D365FOCustomerPaymentJournalLineRequest[],
    chunkSize: number = 20,
    dataAreaId?: string,
    existingLinesLoader?: CashJournalExistingLinesLoader,
    allowUnmarkedInvoiceRetry = false,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const result = await this.postCashLinesForHeader(
      headerKey,
      lines,
      chunkSize,
      dataAreaId,
      'out',
      existingLinesLoader,
      allowUnmarkedInvoiceRetry,
      false,
    );
    return result.postedLines;
  }

  /**
   * Custody Settlement posting path: one UniqueId request can fail without
   * stopping later UniqueIds. Failed groups are returned as skip rows so the
   * caller can write them to the source-mapped Excel report.
   */
  public async postCashOutLinesForHeaderAllowingSkips(
    headerKey: string,
    lines: D365FOCustomerPaymentJournalLineRequest[],
    chunkSize: number = 20,
    dataAreaId?: string,
    existingLinesLoader?: CashJournalExistingLinesLoader,
    allowUnmarkedInvoiceRetry = false,
  ): Promise<{
    postedLines: Array<{ headerId: string; lineNumber: number }>;
    skipped: CustodySettlementSkipRow[];
  }> {
    return this.postCashLinesForHeader(
      headerKey,
      lines,
      chunkSize,
      dataAreaId,
      'out',
      existingLinesLoader,
      allowUnmarkedInvoiceRetry,
      true,
    );
  }

  private async postCashLinesForHeader(
    headerKey: string,
    lines: D365FOCustomerPaymentJournalLineRequest[],
    chunkSize: number,
    dataAreaId: string | undefined,
    cashDirection: 'in' | 'out',
    existingLinesLoader?: CashJournalExistingLinesLoader,
    allowUnmarkedInvoiceRetry = cashDirection === 'out',
    skipFailedUniqueIds = false,
  ): Promise<{
    postedLines: Array<{ headerId: string; lineNumber: number }>;
    skipped: CustodySettlementSkipRow[];
  }> {
    const endpoint =
      cashDirection === 'in'
        ? this.cashInLineEndpoint
        : this.cashOutLineEndpoint;

    this.logger.log(
      cashDirection === 'out'
        ? `[CASH-CUSTOM] Preparing ${lines.length} cash-out lines for header ${headerKey} as one request per UniqueId`
        : `[CASH-CUSTOM] Posting ${lines.length} cash-in lines for header ${headerKey} in chunks of ${chunkSize}`,
    );

    let existingLines: Set<number> = new Set();
    if (dataAreaId && lines.length > 0) {
      try {
        // Cash-out lines live on VendorPaymentJournalLines; cash-in on CustomerPaymentJournalLines.
        const existing = existingLinesLoader
          ? await existingLinesLoader()
          : cashDirection === 'out'
            ? await this.vendorPaymentJournalService.listLinesForHeader(
                headerKey,
                dataAreaId,
              )
            : await this.listLinesForHeader(headerKey, dataAreaId);
        existingLines = new Set(existing.map((l) => l.LineNumber));
      } catch (error) {
        const lookupError = this.dfoErrorExtractor.extractMessage(error);
        throw new NonRetryableDfoPostingError(
          `[CASH-CUSTOM] Could not verify existing lines for header ${headerKey}; posting was stopped to prevent duplicates: ${lookupError}`,
        );
      }
    }

    return this.postCashBulkLinesForHeader(
      endpoint,
      headerKey,
      lines,
      existingLines,
      dataAreaId || lines[0]?.dataAreaId || '',
      allowUnmarkedInvoiceRetry,
      cashDirection,
      skipFailedUniqueIds,
    );
  }

  private async postCashBulkLinesForHeader(
    endpoint: string,
    headerKey: string,
    lines: D365FOCustomerPaymentJournalLineRequest[],
    existingLines: Set<number>,
    dataAreaId: string,
    allowUnmarkedInvoiceRetry: boolean,
    cashDirection: 'in' | 'out',
    skipFailedUniqueIds = false,
  ): Promise<{
    postedLines: Array<{ headerId: string; lineNumber: number }>;
    skipped: CustodySettlementSkipRow[];
  }> {
    const pendingLines: CashBulkPendingLine[] = [];
    const skipped: CustodySettlementSkipRow[] = [];
    const skippedUniqueIds = new Set<string>();
    const skippedLineNumbers = new Set<number>();

    if (cashDirection === 'out') {
      const atomicity = this.inspectCashOutUniqueIdAtomicity(
        lines,
        existingLines,
        skipFailedUniqueIds,
      );
      if (!skipFailedUniqueIds) {
        this.assertCashOutUniqueIdAtomicity(atomicity, headerKey);
      } else {
        for (const line of atomicity.missingPaymentIdLines) {
          skipped.push(
            this.toCashOutPostSkipRow(
              headerKey,
              [
                {
                  lineNumber: line.LineNumber,
                  sourceLineNumber: line.sourceLineNumber,
                  body: line.customLineApiBody,
                },
              ],
              `Cash-out line ${line.LineNumber} in header ${headerKey} is missing PAYMENTID (source UniqueId).`,
            ),
          );
          skippedLineNumbers.add(line.LineNumber);
        }
        for (const group of atomicity.partialGroups) {
          skippedUniqueIds.add(group.atomicKey);
          skipped.push(
            this.toCashOutPostSkipRow(
              headerKey,
              group.lines.map((line) => ({
                lineNumber: line.LineNumber,
                sourceLineNumber: line.sourceLineNumber,
                groupInvoice: line.groupInvoice,
                body: line.customLineApiBody,
              })),
              `Cash-out UniqueId ${group.uniqueId} is only partially present in D365 for header ${headerKey} (${group.existingCount}/${group.lineNumbers.length} lines). Posting was skipped to preserve UniqueId atomicity.`,
            ),
          );
          this.logger.warn(
            `[CASH-CUSTOM] Skipping UniqueId ${group.uniqueId} for header ${headerKey}: partial UniqueId in D365 (${group.existingCount}/${group.lineNumbers.length} lines)`,
          );
        }
      }
    }

    for (const line of lines) {
      if (existingLines.has(line.LineNumber)) continue;
      if (skippedLineNumbers.has(line.LineNumber)) continue;
      const uniqueId = String(line.customLineApiBody?.PAYMENTID ?? '').trim();
      if (
        uniqueId &&
        skippedUniqueIds.has(
          this.cashOutLineGroupKey(
            uniqueId,
            line.groupInvoice,
            skipFailedUniqueIds,
          ),
        )
      )
        continue;

      const body = line.customLineApiBody;
      if (!body) {
        throw new Error(
          `Missing customLineApiBody on cash-${cashDirection} line ${line.LineNumber}`,
        );
      }

      const suppliedJournalNumber = String(body.journalNum ?? '').trim();
      if (suppliedJournalNumber && suppliedJournalNumber !== headerKey) {
        throw new Error(
          `Cash-${cashDirection} line ${line.LineNumber} belongs to journal ${suppliedJournalNumber}, not ${headerKey}`,
        );
      }

      const pendingBody = {
        ...body,
        journalNum: headerKey,
      };
      pendingLines.push({
        lineNumber: line.LineNumber,
        sourceLineNumber: line.sourceLineNumber,
        groupInvoice: String(line.groupInvoice ?? '').trim(),
        body: pendingBody,
      });
    }

    if (cashDirection === 'out') {
      this.removeDuplicateSettlementMarks(pendingLines);
    }

    const batches =
      cashDirection === 'out'
        ? this.groupCashOutPendingLinesByUniqueId(
            pendingLines,
            skipFailedUniqueIds,
          )
        : this.chunkCashPendingLines(pendingLines, this.cashOutBulkBatchSize);
    const totalBatches = batches.length;

    const unmarkedSettlements: VendorPaymentJournalSettlementTarget[] = [];

    for (const [index, pendingBatch] of batches.entries()) {
      try {
        const batchResult = await this.postCashOutBulkBatch(
          endpoint,
          headerKey,
          pendingBatch,
          dataAreaId,
          allowUnmarkedInvoiceRetry,
          { number: index + 1, total: totalBatches },
          cashDirection,
          skipFailedUniqueIds,
        );
        unmarkedSettlements.push(...batchResult.unmarkedSettlements);
        if (batchResult.settlementSkip) {
          skipped.push(batchResult.settlementSkip);
        }
      } catch (error) {
        if (!skipFailedUniqueIds || cashDirection !== 'out') {
          throw error;
        }
        const skipRow = this.toCashOutPostSkipRow(
          headerKey,
          pendingBatch,
          error,
        );
        skipped.push(skipRow);
        skippedUniqueIds.add(
          this.cashOutLineGroupKey(
            skipRow.uniqueId,
            pendingBatch[0]?.groupInvoice,
            skipFailedUniqueIds,
          ),
        );
        this.logger.warn(
          `[CASH-CUSTOM] Skipping UniqueId ${skipRow.uniqueId || '?'} for header ${headerKey}: ${skipRow.error}`,
        );
      }
    }

    const settleBlockedUniqueIds = new Set(
      skipped
        .filter(
          (row) =>
            row.phase === 'settle' &&
            !isAlreadyMarkedUnmarkedUploadSkip(row),
        )
        .map((row) => row.uniqueId)
        .filter((uniqueId) => uniqueId.length > 0),
    );
    const settleTargets = unmarkedSettlements.filter((target) => {
      if (!target.uniqueId) return true;
      const skipKey = this.cashOutLineGroupKey(
        target.uniqueId,
        target.invoiceNumber,
        skipFailedUniqueIds,
      );
      return (
        !skippedUniqueIds.has(skipKey) &&
        !settleBlockedUniqueIds.has(target.uniqueId)
      );
    });
    if (cashDirection === 'out' && settleTargets.length > 0) {
      this.logger.log(
        `[CASH-CUSTOM] Marking ${settleTargets.length} unmarked vendor settlement(s) for header ${headerKey} after UniqueId upload`,
      );
      await this.vendorInvoiceJournalService.createVendorPaymentJournalLineSettlements(
        {
          company: dataAreaId,
          journalBatchNumber: headerKey,
          targets: settleTargets,
          continueOnError: skipFailedUniqueIds,
          skipped: skipFailedUniqueIds ? skipped : undefined,
        },
      );
    }

    const postedLines = lines
      .filter((line) => {
        if (skippedLineNumbers.has(line.LineNumber)) return false;
        const uniqueId = String(line.customLineApiBody?.PAYMENTID ?? '').trim();
        if (!uniqueId) return true;
        return !skippedUniqueIds.has(
          this.cashOutLineGroupKey(
            uniqueId,
            line.groupInvoice,
            skipFailedUniqueIds,
          ),
        );
      })
      .map((line) => ({
        headerId: headerKey,
        lineNumber: line.LineNumber,
      }));

    return { postedLines, skipped };
  }

  private toCashOutPostSkipRow(
    headerKey: string,
    pendingBatch: CashBulkPendingLine[],
    error: unknown,
    phase: CustodySettlementSkipPhase = 'post',
  ): CustodySettlementSkipRow {
    const first = pendingBatch[0];
    const marked = first?.body.MarkedLines?.[0];
    const uniqueId = String(first?.body.PAYMENTID ?? '').trim();
    const netAmount = pendingBatch.reduce(
      (sum, line) =>
        sum +
        Number(line.body.creditAmount ?? 0) -
        Number(line.body.debitAmount ?? 0),
      0,
    );
    return createCustodySettlementSkipRow({
      uniqueId,
      excelLineNumbers: pendingBatch.map((line) => line.sourceLineNumber),
      journalBatchNumber: headerKey,
      d365LineNumbers: pendingBatch.map((line) => line.lineNumber),
      vendorAccount: String(first?.body.AccountNum ?? '').trim(),
      invoiceNumber: String(marked?.InvoiceNumber ?? '').trim(),
      documentNumber: String(
        marked?.DocumentNumber ?? first?.body.DocumentNum ?? '',
      ).trim(),
      amount: Math.abs(netAmount),
      phase,
      error,
    });
  }

  /**
   * Submit exactly one UniqueId (or one Cash-In chunk) to D365. After a
   * successful Cash-Out request, unmarked leftovers from this same journal
   * are returned so the header can OData-mark them after UniqueId upload.
   *
   * Custody Settlement UniqueIds that fail because X++ hit an already-marked
   * open trans are retried without MarkedLines so the journal line still lands.
   * The line is then OData-marked the same way as the D365 settlement form.
   */
  private async postCashOutBulkBatch(
    endpoint: string,
    headerKey: string,
    pendingLines: CashBulkPendingLine[],
    dataAreaId: string,
    _allowUnmarkedInvoiceRetry: boolean,
    batch: CashBulkBatch,
    cashDirection: 'in' | 'out' = 'out',
    skipFailedUniqueIds = false,
  ): Promise<CashOutBulkBatchResult> {
    if (pendingLines.length === 0) return { unmarkedSettlements: [] };

    this.logger.log(
      `[CASH-CUSTOM] Submitting ${pendingLines.length} cash-${cashDirection} lines in request ${batch.number}/${batch.total} for header ${headerKey}`,
    );

    const result = await this.postCustomCashLines(
      endpoint,
      pendingLines.map((line) => line.body),
      { headerKey, pendingLines, attempt: 'initial', batch },
      cashDirection,
    );
    const failures = this.extractCashBulkFailures(result, pendingLines);
    await this.logCashBulkOutcome({
      headerKey,
      pendingLines,
      attempt: 'initial',
      batch,
      result,
      failures,
    });

    if (failures.length === 0) {
      if (cashDirection === 'out') {
        const unmarkedLines = await this.verifyCashOutMarkedSettlements(
          headerKey,
          pendingLines,
          dataAreaId,
          batch,
        );
        return {
          unmarkedSettlements: unmarkedLines
            .map((line) => this.toUnmarkedODataSettlementTarget(line))
            .filter((target): target is VendorPaymentJournalSettlementTarget =>
              Boolean(target),
            ),
        };
      }
      return { unmarkedSettlements: [] };
    }

    const alreadyMarkedWithoutSettlement =
      skipFailedUniqueIds &&
      cashDirection === 'out' &&
      this.failuresMatch(failures, (message) =>
        this.isAlreadyMarkedForSettlementError(message),
      );
    const remainingAmountUnmarkedRetry =
      _allowUnmarkedInvoiceRetry &&
      this.failuresMatch(failures, (message) =>
        this.isInvoiceAmountGreaterThanRemainingError(message),
      );

    if (alreadyMarkedWithoutSettlement || remainingAmountUnmarkedRetry) {
      const retryIndexes = this.cashBulkRetryIndexes(failures, pendingLines);
      if (retryIndexes.length === 0) {
        throw new NonRetryableDfoPostingError(
          this.formatCashBulkFailure(headerKey, failures, cashDirection),
        );
      }

      const retryPendingLines = retryIndexes.map((requestIndex) => {
        const line = pendingLines[requestIndex];
        return {
          ...line,
          body: this.buildUnmarkedCashLine(line.body),
        };
      });

      const retryResult = await this.postCustomCashLines(
        endpoint,
        retryPendingLines.map((line) => line.body),
        {
          headerKey,
          pendingLines: retryPendingLines,
          attempt: 'unmarked_retry',
          batch,
        },
        cashDirection,
      );
      const retryFailures = this.extractCashBulkFailures(
        retryResult,
        retryPendingLines,
      );
      if (retryFailures.length === 0) {
        if (alreadyMarkedWithoutSettlement) {
          const originalMessage = failures
            .map((failure) => failure.message)
            .find((message) => this.isAlreadyMarkedForSettlementError(message));
          const odataTargets = retryIndexes
            .map((requestIndex) =>
              this.toUnmarkedODataSettlementTarget(pendingLines[requestIndex]),
            )
            .filter((target): target is VendorPaymentJournalSettlementTarget =>
              Boolean(target),
            );
          this.logger.warn(
            `[CASH-CUSTOM] UniqueId uploaded without MarkedLines for header ${headerKey}: ${originalMessage}. ${odataTargets.length} line(s) will be OData-marked the same way as the settlement form.`,
          );
          if (odataTargets.length === 0) {
            return {
              unmarkedSettlements: [],
              settlementSkip: this.toCashOutPostSkipRow(
                headerKey,
                pendingLines,
                `Line uploaded without settlement: ${originalMessage}`,
                'settle',
              ),
            };
          }
          return { unmarkedSettlements: odataTargets };
        }
        return {
          unmarkedSettlements: retryIndexes
            .map((requestIndex) =>
              this.toUnmarkedODataSettlementTarget(pendingLines[requestIndex]),
            )
            .filter((target): target is VendorPaymentJournalSettlementTarget =>
              Boolean(target),
            ),
        };
      }
      throw new NonRetryableDfoPostingError(
        this.formatCashBulkFailure(headerKey, retryFailures, cashDirection),
      );
    }

    throw new NonRetryableDfoPostingError(
      this.formatCashBulkFailure(headerKey, failures, cashDirection),
    );
  }

  /**
   * Map a FO bulk response onto the lines we submitted.
   *
   * Live `TSAddLedgerJournalResponse` is all-or-nothing (one TTS): only overall
   * StatusCode/Message are set. Remaining-amount and already-marked settlement
   * errors are attributed to every submitted line so the unmarked retry can
   * clear MarkedLines for the whole UniqueId. Optional per-line arrays are
   * parsed only when FO returns them.
   */
  private extractCashBulkFailures(
    result: TSLedgerJournalTransCustomBulkResponseBody | null | undefined,
    pendingLines: CashBulkPendingLine[],
  ): CashBulkLineFailure[] {
    if (!result) {
      return [
        {
          requestIndex: pendingLines.length === 1 ? 0 : -1,
          lineNumber:
            pendingLines.length === 1 ? pendingLines[0].lineNumber : undefined,
          message: 'D365 returned an empty bulk response.',
          correlated: pendingLines.length === 1,
        },
      ];
    }

    const responseLines =
      result?.Lines ?? result?.lines ?? result?.Results ?? result?.results;
    const hasLineResults =
      Array.isArray(responseLines) && responseLines.length > 0;

    if (hasLineResults) {
      const failures: CashBulkLineFailure[] = [];
      responseLines.forEach((responseLine, responseIndex) => {
        if (!this.isCashBulkLineFailure(responseLine)) return;

        const explicitLineNumber = Number(
          responseLine.LineNumber ?? responseLine.lineNumber,
        );
        const matchedIndex = Number.isFinite(explicitLineNumber)
          ? pendingLines.findIndex(
              (line) => line.lineNumber === explicitLineNumber,
            )
          : -1;
        const requestIndex =
          matchedIndex >= 0
            ? matchedIndex
            : responseIndex < pendingLines.length
              ? responseIndex
              : -1;
        failures.push({
          requestIndex,
          lineNumber: pendingLines[requestIndex]?.lineNumber,
          message: this.cashBulkResponseMessage(responseLine),
          correlated: requestIndex >= 0,
        });
      });

      if (failures.length > 0) return failures;
      if (
        this.isSuccessfulCashStatus(result?.StatusCode ?? result?.statusCode)
      ) {
        return [];
      }
    }

    if (this.isSuccessfulCashStatus(result?.StatusCode ?? result?.statusCode)) {
      return [];
    }

    const overallStatus = String(
      result?.StatusCode ?? result?.statusCode ?? '',
    ).trim();
    if (!overallStatus && !result?.Message && !result?.message) {
      if (hasLineResults) return [];
      return [
        {
          requestIndex: pendingLines.length === 1 ? 0 : -1,
          lineNumber:
            pendingLines.length === 1 ? pendingLines[0].lineNumber : undefined,
          message: 'D365 returned an empty bulk response.',
          correlated: pendingLines.length === 1,
        },
      ];
    }

    const message = this.cashBulkResponseMessage(result);

    // All-or-nothing TTS rolled the chunk back; attribute the message to every
    // submitted line so the caller gets a deterministic per-line failure report.
    if (
      this.isInvoiceAmountGreaterThanRemainingError(message) ||
      this.isAlreadyMarkedForSettlementError(message)
    ) {
      return pendingLines.map((line, requestIndex) => ({
        requestIndex,
        lineNumber: line.lineNumber,
        message,
        correlated: true,
      }));
    }

    if (pendingLines.length === 1) {
      return [
        {
          requestIndex: 0,
          lineNumber: pendingLines[0].lineNumber,
          message,
          correlated: true,
        },
      ];
    }

    return [
      {
        requestIndex: -1,
        message,
        correlated: false,
      },
    ];
  }

  private isCashBulkLineFailure(
    result: TSLedgerJournalTransCustomBulkLineResponseBody,
  ): boolean {
    const success = result?.Success ?? result?.success;
    if (success !== undefined) return success === false;

    const status = result?.StatusCode ?? result?.statusCode;
    return Boolean(status) && !this.isSuccessfulCashStatus(status);
  }

  private isSuccessfulCashStatus(status: string | undefined): boolean {
    return ['success', 'succeeded', 'ok'].includes(
      String(status ?? '')
        .trim()
        .toLowerCase(),
    );
  }

  private cashBulkResponseMessage(result: unknown): string {
    const messages = this.collectCashBulkResponseMessages(result);
    const detailedMessage = messages.find(
      (message) => !this.isGenericCashBulkMessage(message),
    );

    return detailedMessage ?? messages[0] ?? 'Unknown D365 error';
  }

  private collectCashBulkResponseMessages(
    value: unknown,
    depth: number = 0,
  ): string[] {
    if (depth > 4 || value === null || value === undefined) return [];
    if (typeof value === 'string') {
      const message = value.trim();
      return message ? [message] : [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) =>
        this.collectCashBulkResponseMessages(item, depth + 1),
      );
    }
    if (typeof value !== 'object') return [];

    const record = value as Record<string, unknown>;
    const messageKeys = [
      'ExceptionMessage',
      'exceptionMessage',
      'ErrorMessage',
      'errorMessage',
      'Details',
      'details',
      'Message',
      'message',
    ];
    const nestedKeys = [
      'Error',
      'error',
      'InnerException',
      'innerException',
      'innererror',
      'innerError',
      'internalexception',
      'internalException',
    ];

    return [...messageKeys, ...nestedKeys].flatMap((key) =>
      this.collectCashBulkResponseMessages(record[key], depth + 1),
    );
  }

  private isGenericCashBulkMessage(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return (
      normalized === 'an unexpected x++ error occurred.' ||
      normalized === 'an unexpected x++ error occurred' ||
      normalized === 'an error has occurred.' ||
      normalized === 'an error has occurred'
    );
  }

  private formatCashBulkFailure(
    headerKey: string,
    failures: CashBulkLineFailure[],
    cashDirection: 'in' | 'out' = 'out',
  ): string {
    const details = failures
      .map((failure) =>
        failure.lineNumber === undefined
          ? failure.message
          : `line ${failure.lineNumber}: ${failure.message}`,
      )
      .join('; ');
    return `Failed to post cash-${cashDirection} lines for header ${headerKey}: ${details}`;
  }

  private isInvoiceAmountGreaterThanRemainingError(message: string): boolean {
    const normalized = String(message ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    return (
      normalized.includes('amount of the invoice') &&
      normalized.includes('is greater than the') &&
      (normalized.includes('remain amount') ||
        normalized.includes('remaining amount'))
    );
  }

  private isAlreadyMarkedForSettlementError(message: string): boolean {
    const normalized = String(message ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    // D365 names the journal "Vendor Payment Freight" or "Vendor Payment Fleet".
    return (
      normalized.includes('has been marked for settlement') ||
      normalized.includes('already marked for settlement')
    );
  }

  private failuresMatch(
    failures: CashBulkLineFailure[],
    predicate: (message: string) => boolean,
  ): boolean {
    return (
      failures.length > 0 &&
      failures.every((failure) => predicate(failure.message))
    );
  }

  private cashBulkRetryIndexes(
    failures: CashBulkLineFailure[],
    pendingLines: CashBulkPendingLine[],
  ): number[] {
    return [
      ...new Set(
        failures
          .map((failure) => failure.requestIndex)
          .filter(
            (requestIndex) =>
              requestIndex >= 0 && requestIndex < pendingLines.length,
          ),
      ),
    ];
  }

  /**
   * Prevent opposite debit/credit journal lines from competing for the same
   * settlement target. Two debit Vendor Payment lines are intentionally not
   * deduplicated: the main payment and its explicit 223304 withholding
   * companion each settle their own amount against the supplied invoice.
   */
  private removeDuplicateSettlementMarks(
    pendingLines: CashBulkPendingLine[],
  ): void {
    const debitSettlementKeys = new Set<string>();

    for (const line of pendingLines) {
      if (
        String(line.body.accountTypeStr ?? '')
          .trim()
          .toLowerCase() !== 'vendor' ||
        Number(line.body.debitAmount ?? 0) <= 0
      ) {
        continue;
      }
      for (const markedLine of line.body.MarkedLines ?? []) {
        debitSettlementKeys.add(this.cashSettlementIdentity(markedLine));
      }
    }

    for (const line of pendingLines) {
      if (
        String(line.body.accountTypeStr ?? '')
          .trim()
          .toLowerCase() !== 'vendor' ||
        Number(line.body.creditAmount ?? 0) <= 0 ||
        String(line.body.VendorGroup ?? '')
          .trim()
          .toLowerCase() === 'custody' ||
        !Array.isArray(line.body.MarkedLines) ||
        line.body.MarkedLines.length === 0
      ) {
        continue;
      }

      this.removeOwnedSettlementMarks(line, debitSettlementKeys);
    }
  }

  private removeOwnedSettlementMarks(
    line: CashBulkPendingLine,
    ownedSettlementKeys: ReadonlySet<string>,
  ): void {
    const markedLines = line.body.MarkedLines ?? [];
    const removedMarks = markedLines.filter((markedLine) =>
      ownedSettlementKeys.has(this.cashSettlementIdentity(markedLine)),
    );
    if (removedMarks.length === 0) return;

    const remainingMarks = markedLines.filter(
      (markedLine) =>
        !ownedSettlementKeys.has(this.cashSettlementIdentity(markedLine)),
    );
    line.body.MarkedLines = remainingMarks;
    if (remainingMarks.length > 0) return;

    const invoiceDescription = this.markedInvoiceDescription(removedMarks);
    line.body.PAYMENTNOTES = this.formatUnmarkedDescription(
      invoiceDescription,
      line.body.PAYMENTNOTES || line.body.TRANSACTIONTEXT || '',
    );
    line.body.TRANSACTIONTEXT = this.formatUnmarkedDescription(
      invoiceDescription,
      line.body.TRANSACTIONTEXT || line.body.PAYMENTNOTES || '',
    );
  }

  private cashSettlementIdentity(markedLine: {
    InvoiceNumber?: string;
    OperationNumber?: string;
    DocumentNumber?: string;
  }): string {
    return [
      markedLine.InvoiceNumber,
      markedLine.OperationNumber,
      markedLine.DocumentNumber,
    ]
      .map((value) =>
        String(value ?? '')
          .trim()
          .toLowerCase(),
      )
      .join('|');
  }

  /**
   * Keep adjacent journal lines that settle the same vendor transaction in one
   * FO request. In particular, a main payment and its explicit 223304
   * companion must share the same TTS; committing the main line in one request
   * leaves the VendTrans reserved and the next request is rejected as already
   * marked by the same journal.
   */
  private chunkCashPendingLines(
    pendingLines: CashBulkPendingLine[],
    maxLines: number,
  ): CashBulkPendingLine[][] {
    const atomicGroups: CashBulkPendingLine[][] = [];
    let currentGroup: CashBulkPendingLine[] = [];
    let currentKeys = new Set<string>();

    for (const line of pendingLines) {
      const lineKeys = new Set(
        (line.body.MarkedLines ?? []).map(
          (markedLine) =>
            `${String(line.body.AccountNum ?? '')
              .trim()
              .toLowerCase()}|${this.cashSettlementIdentity(markedLine)}`,
        ),
      );
      const sharesSettlement = [...lineKeys].some((key) =>
        currentKeys.has(key),
      );

      if (currentGroup.length > 0 && !sharesSettlement) {
        atomicGroups.push(currentGroup);
        currentGroup = [];
        currentKeys = new Set<string>();
      }
      currentGroup.push(line);
      for (const key of lineKeys) currentKeys.add(key);
    }
    if (currentGroup.length > 0) atomicGroups.push(currentGroup);

    const batches: CashBulkPendingLine[][] = [];
    let batch: CashBulkPendingLine[] = [];
    for (const group of atomicGroups) {
      if (group.length > maxLines) {
        throw new Error(
          `Cash settlement group contains ${group.length} lines, exceeding the D365 request limit of ${maxLines}.`,
        );
      }
      if (batch.length > 0 && batch.length + group.length > maxLines) {
        batches.push(batch);
        batch = [];
      }
      batch.push(...group);
    }
    if (batch.length > 0) batches.push(batch);
    return batches;
  }

  /**
   * Inspect the durable retry boundary before filtering already-posted lines.
   * A Cash-Out request is atomic per source UniqueId, so a partially existing
   * group must never be resumed as an incomplete request.
   */
  private inspectCashOutUniqueIdAtomicity(
    lines: D365FOCustomerPaymentJournalLineRequest[],
    existingLines: ReadonlySet<number>,
    splitByInvoice = false,
  ): {
    missingPaymentIdLines: D365FOCustomerPaymentJournalLineRequest[];
    partialGroups: Array<{
      uniqueId: string;
      atomicKey: string;
      lineNumbers: number[];
      existingCount: number;
      lines: D365FOCustomerPaymentJournalLineRequest[];
    }>;
  } {
    const groups = new Map<
      string,
      {
        uniqueId: string;
        lineNumbers: number[];
        existingCount: number;
        lines: D365FOCustomerPaymentJournalLineRequest[];
      }
    >();
    const missingPaymentIdLines: D365FOCustomerPaymentJournalLineRequest[] = [];

    for (const line of lines) {
      if (!line.customLineApiBody) continue;
      const uniqueId = String(line.customLineApiBody.PAYMENTID ?? '').trim();
      if (!uniqueId) {
        missingPaymentIdLines.push(line);
        continue;
      }

      const atomicKey = this.cashOutLineGroupKey(
        uniqueId,
        line.groupInvoice,
        splitByInvoice,
      );
      const group = groups.get(atomicKey) ?? {
        uniqueId,
        lineNumbers: [],
        existingCount: 0,
        lines: [],
      };
      group.lineNumbers.push(line.LineNumber);
      group.lines.push(line);
      if (existingLines.has(line.LineNumber)) group.existingCount++;
      groups.set(atomicKey, group);
    }

    return {
      missingPaymentIdLines,
      partialGroups: [...groups.entries()]
        .filter(
          ([, group]) =>
            group.existingCount > 0 &&
            group.existingCount < group.lineNumbers.length,
        )
        .map(([atomicKey, group]) => ({ atomicKey, ...group })),
    };
  }

  private assertCashOutUniqueIdAtomicity(
    atomicity: ReturnType<
      CustomerPaymentJournalService['inspectCashOutUniqueIdAtomicity']
    >,
    headerKey: string,
  ): void {
    const missing = atomicity.missingPaymentIdLines[0];
    if (missing) {
      throw new Error(
        `Cash-out line ${missing.LineNumber} in header ${headerKey} is missing PAYMENTID (source UniqueId).`,
      );
    }

    const partial = atomicity.partialGroups[0];
    if (partial) {
      throw new Error(
        `Cash-out UniqueId ${partial.uniqueId} is only partially present in D365 for header ${headerKey} (${partial.existingCount}/${partial.lineNumbers.length} lines). Posting was stopped to preserve UniqueId atomicity.`,
      );
    }
  }

  /**
   * Build Cash-Out requests per source UniqueId. Custody Settlement UniqueIds
   * that contain several invoices are split so each invoice is its own TTS.
   * Groups containing a Custody vendor are sent first, followed by other
   * non-empty vendor groups, then groups whose VendorGroup is empty.
   */
  private groupCashOutPendingLinesByUniqueId(
    pendingLines: CashBulkPendingLine[],
    splitByInvoice = false,
  ): CashBulkPendingLine[][] {
    const groups = new Map<
      string,
      { lines: CashBulkPendingLine[]; priority: number; firstIndex: number }
    >();

    for (const [index, line] of pendingLines.entries()) {
      const uniqueId = String(line.body.PAYMENTID ?? '').trim();
      if (!uniqueId) {
        throw new Error(
          `Cash-out line ${line.lineNumber} is missing PAYMENTID (source UniqueId).`,
        );
      }

      const vendorGroup = String(line.body.VendorGroup ?? '').trim();
      const linePriority =
        vendorGroup.toLowerCase() === 'custody' ? 0 : vendorGroup ? 1 : 2;
      const groupKey = this.cashOutLineGroupKey(
        uniqueId,
        line.groupInvoice ||
          String(line.body.MarkedLines?.[0]?.InvoiceNumber ?? '').trim(),
        splitByInvoice,
      );
      const group = groups.get(groupKey) ?? {
        lines: [],
        priority: 2,
        firstIndex: index,
      };
      group.lines.push(line);
      group.priority = Math.min(group.priority, linePriority);
      groups.set(groupKey, group);
    }

    const orderedGroups = [...groups.entries()].sort(
      ([, left], [, right]) =>
        left.priority - right.priority || left.firstIndex - right.firstIndex,
    );

    return orderedGroups.map(([, group]) => group.lines);
  }

  private cashOutLineGroupKey(
    uniqueId: string,
    groupInvoice: string | undefined,
    splitByInvoice: boolean,
  ): string {
    if (!splitByInvoice) return uniqueId;
    return `${uniqueId}::${String(groupInvoice ?? '').trim()}`;
  }

  private toUnmarkedODataSettlementTarget(
    line: CashBulkPendingLine | undefined,
  ): VendorPaymentJournalSettlementTarget | undefined {
    if (!line) return undefined;
    const vendorAccount = String(line.body.AccountNum ?? '').trim();
    const accountType = String(line.body.accountTypeStr ?? '')
      .trim()
      .toLowerCase();
    if (
      !vendorAccount ||
      (accountType && accountType !== 'vendor' && accountType !== 'vend')
    ) {
      return undefined;
    }
    const marked = line.body.MarkedLines?.[0];
    const invoiceNumber = String(marked?.InvoiceNumber ?? '').trim();
    if (!invoiceNumber) return undefined;
    const uniqueId = String(line.body.PAYMENTID ?? '').trim();
    return {
      lineNumber: line.lineNumber,
      vendorAccount,
      currencyCode: String(line.body.currency ?? '').trim(),
      debitAmount: Number(line.body.debitAmount ?? 0),
      creditAmount: Number(line.body.creditAmount ?? 0),
      invoiceNumber,
      documentNumber: String(marked?.DocumentNumber ?? '').trim(),
      ...(uniqueId ? { uniqueId } : {}),
      ...(Number(line.sourceLineNumber) > 0
        ? { sourceLineNumber: Number(line.sourceLineNumber) }
        : {}),
    };
  }

  private formatUnmarkedDescription(
    invoiceNumber: string,
    currentDescription = '',
  ): string {
    const invoice = String(invoiceNumber ?? '').trim();
    if (invoice) return `Unmarked - ${invoice}`;

    const current = String(currentDescription ?? '').trim();
    if (!current) return 'Unmarked';
    if (current.toLowerCase().includes('unmarked')) return current;
    return `${current} - unmarked`;
  }

  private markedInvoiceDescription(
    markedLines: TSLedgerJournalTransCustomRequestBody['MarkedLines'],
  ): string {
    return [
      ...new Set(
        (markedLines ?? [])
          .map((line) => String(line.InvoiceNumber ?? '').trim())
          .filter(Boolean),
      ),
    ].join(', ');
  }

  private buildUnmarkedCashLine(
    body: TSLedgerJournalTransCustomRequestBody,
  ): TSLedgerJournalTransCustomRequestBody {
    const retryBody = { ...body };
    const invoiceDescription = this.markedInvoiceDescription(body.MarkedLines);
    retryBody.MarkedLines = [];
    delete (retryBody as any).MARKEDINVOICE;
    retryBody.PAYMENTNOTES = this.formatUnmarkedDescription(
      invoiceDescription,
      retryBody.PAYMENTNOTES,
    );
    retryBody.TRANSACTIONTEXT = this.formatUnmarkedDescription(
      invoiceDescription,
      retryBody.TRANSACTIONTEXT,
    );
    return retryBody;
  }

  private async postCustomCashLine(
    endpoint: string,
    body: TSLedgerJournalTransCustomRequestBody,
  ): Promise<TSLedgerJournalTransCustomResponseBody> {
    try {
      const result = await this.d365foClient.post<
        TSLedgerJournalTransCustomRequest,
        TSLedgerJournalTransCustomResponseBody
      >(endpoint, { _contract: this.toD365BulkCashLine(body) });

      const statusCode = result?.StatusCode;
      if (statusCode === 'Success') {
        return result;
      }

      const message = result?.Message ?? JSON.stringify(result);
      throw new Error(message);
    } catch (error: unknown) {
      const data = (error as any)?.response?.data;
      const message =
        data?.Message ??
        data?.message ??
        (error as any)?.message ??
        String(error);
      throw new Error(message);
    }
  }

  private async postCustomCashLines(
    endpoint: string,
    lines: TSLedgerJournalTransCustomRequestBody[],
    context: {
      headerKey: string;
      pendingLines: CashBulkPendingLine[];
      attempt: CashBulkAttempt;
      batch: CashBulkBatch;
    },
    cashDirection: 'in' | 'out',
  ): Promise<TSLedgerJournalTransCustomBulkResponseBody> {
    const requestBody: TSLedgerJournalTransCustomBulkRequest = {
      _contract: {
        Lines: lines.map((line) =>
          this.toD365BulkCashLine(line, cashDirection),
        ),
      },
    };

    // Logged before the call so the exact submitted body is available even if
    // the request never returns.
    await this.logCashBulkRequest(endpoint, requestBody, context);

    try {
      // Long timeout + no client retries: FO may still be inside TTS after a
      // client abort; re-POSTing the same Lines risks duplicates.
      return await this.d365foClient.post<
        TSLedgerJournalTransCustomBulkRequest,
        TSLedgerJournalTransCustomBulkResponseBody
      >(endpoint, requestBody, {
        timeout: this.cashOutBulkHttpTimeout,
        retries: 0,
      });
    } catch (error: unknown) {
      throw new Error(this.dfoErrorExtractor.extractMessage(error));
    }
  }

  private async verifyCashOutMarkedSettlements(
    headerKey: string,
    pendingLines: CashBulkPendingLine[],
    dataAreaId: string,
    batch: CashBulkBatch,
  ): Promise<CashBulkPendingLine[]> {
    const verificationTargets = pendingLines
      .map((line) => ({
        lineNumber: line.lineNumber,
        vendorAccount: String(line.body.AccountNum ?? '').trim(),
        expectedInvoices: Array.isArray(line.body.MarkedLines)
          ? line.body.MarkedLines.map((markedLine) =>
              String(markedLine?.InvoiceNumber ?? '').trim(),
            ).filter(Boolean)
          : [],
      }))
      .filter(
        (line) =>
          Boolean(line.vendorAccount) && line.expectedInvoices.length > 0,
      );

    if (verificationTargets.length === 0) return [];

    const verification = await this.pollCashOutSettlementVerification(
      dataAreaId,
      headerKey,
      verificationTargets,
    );
    await this.logCashSettlementVerification(headerKey, batch, verification);

    const failures = verification.filter(
      (result) => result.status !== 'VERIFIED',
    );
    if (failures.length === 0) return [];

    const safelyUnmarked = failures.filter((failure) => {
      const settleVoucher = failure.settleVoucher.trim().toLowerCase();
      return (
        failure.status === 'NOT_VERIFIED' &&
        failure.journalLineExists === true &&
        failure.matchedInvoices.length === 0 &&
        !failure.journalMarkedInvoice.trim() &&
        (!settleVoucher || settleVoucher === 'none')
      );
    });

    for (const failure of safelyUnmarked) {
      const pendingLine = pendingLines.find(
        (line) => line.lineNumber === failure.lineNumber,
      );
      const description = this.formatUnmarkedDescription(
        this.markedInvoiceDescription(pendingLine?.body.MarkedLines ?? []) ||
          failure.expectedInvoices.join(', '),
        pendingLine?.body.TRANSACTIONTEXT ||
          pendingLine?.body.PAYMENTNOTES ||
          '',
      );
      await this.vendorPaymentJournalService.updateLineDescription(
        headerKey,
        failure.lineNumber,
        dataAreaId,
        description,
      );
    }

    if (safelyUnmarked.length > 0) {
      await this.operationalLogs.emit({
        level: 'warn',
        message: `D365 persisted ${safelyUnmarked.length} vendor payment line(s) without settlement; the lines were preserved and labelled unmarked`,
        context: CustomerPaymentJournalService.name,
        eventType: 'd365fo.cash-out.settlement-fallback',
        status: 'unmarked',
        metadata: {
          journalNum: headerKey,
          requestNumber: batch.number,
          requestCount: batch.total,
          lineNumbers: safelyUnmarked.map((failure) => failure.lineNumber),
          expectedInvoices: safelyUnmarked.map((failure) => ({
            lineNumber: failure.lineNumber,
            invoices: failure.expectedInvoices,
          })),
        },
      });
    }

    const unsafeFailures = failures.filter(
      (failure) => !safelyUnmarked.includes(failure),
    );
    if (unsafeFailures.length > 0) {
      throw new NonRetryableDfoPostingError(
        `Cash-out journal ${headerKey} was accepted by D365, but settlement verification failed: ${unsafeFailures
          .map((failure) => `line ${failure.lineNumber}: ${failure.reason}`)
          .join('; ')}`,
      );
    }

    const unmarkedLineNumbers = new Set(
      safelyUnmarked.map((failure) => failure.lineNumber),
    );
    return pendingLines.filter((line) => unmarkedLineNumbers.has(line.lineNumber));
  }

  private async pollCashOutSettlementVerification(
    dataAreaId: string,
    headerKey: string,
    verificationTargets: Array<{
      lineNumber: number;
      vendorAccount: string;
      expectedInvoices: string[];
    }>,
  ): Promise<VendorPaymentSettlementVerification[]> {
    const maxAttempts = 3;
    const delayMs = 1500;
    let lastResults: VendorPaymentSettlementVerification[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      lastResults =
        await this.vendorInvoiceJournalService.verifyVendorPaymentJournalSettlements(
          {
            company: dataAreaId,
            journalBatchNumber: headerKey,
            lines: verificationTargets,
          },
        );

      if (lastResults.every((result) => result.status === 'VERIFIED')) {
        return lastResults;
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return lastResults;
  }

  private async logCashSettlementVerification(
    headerKey: string,
    batch: CashBulkBatch,
    verification: VendorPaymentSettlementVerification[],
  ): Promise<void> {
    const succeeded = verification.every(
      (result) => result.status === 'VERIFIED',
    );

    await this.operationalLogs.emit({
      level: succeeded ? 'info' : 'error',
      message: succeeded
        ? `Cash-out settlement verification passed for journal ${headerKey} request ${batch.number}/${batch.total}`
        : `Cash-out settlement verification failed for journal ${headerKey} request ${batch.number}/${batch.total}`,
      context: CustomerPaymentJournalService.name,
      eventType: 'd365fo.cash-out.settlement-verification',
      status: succeeded ? 'verified' : 'not_verified',
      metadata: {
        journalNum: headerKey,
        requestNumber: batch.number,
        requestCount: batch.total,
        verificationCount: verification.length,
        settlementVerificationStatus: succeeded ? 'VERIFIED' : 'NOT_VERIFIED',
        results: verification.map((result) => ({
          lineNumber: result.lineNumber,
          status: result.status,
          expectedVendorAccount: result.expectedVendorAccount,
          expectedInvoices: result.expectedInvoices,
          matchedInvoices: result.matchedInvoices,
          settlementAmount: result.settlementAmount,
          journalMarkedInvoice: result.journalMarkedInvoice,
          settleVoucher: result.settleVoucher,
          reason: result.reason,
        })),
      },
    });
  }

  /**
   * Record the complete `{ _contract: { Lines: [...] } }` body together with
   * the request-index-to-line-number map used to correlate response errors.
   */
  private async logCashBulkRequest(
    endpoint: string,
    requestBody: TSLedgerJournalTransCustomBulkRequest,
    context: {
      headerKey: string;
      pendingLines: CashBulkPendingLine[];
      attempt: CashBulkAttempt;
      batch: CashBulkBatch;
    },
  ): Promise<void> {
    const lineCount = requestBody._contract.Lines.length;

    await this.operationalLogs.emit({
      level: 'info',
      message: `Cash-out bulk request ${context.batch.number}/${context.batch.total} for journal ${context.headerKey} with ${lineCount} line(s)`,
      context: CustomerPaymentJournalService.name,
      eventType: 'd365fo.cash-out.bulk-request',
      status: 'submitted',
      metadata: {
        endpoint,
        journalNum: context.headerKey,
        attempt: context.attempt,
        requestNumber: context.batch.number,
        requestCount: context.batch.total,
        lineCount,
        lineNumbers: context.pendingLines.map((line) => line.lineNumber),
        settlementIntent: context.pendingLines.some(
          (line) => (line.body.MarkedLines?.length ?? 0) > 0,
        )
          ? 'MARKED'
          : 'UNMARKED',
        markedLineNumbers: context.pendingLines
          .filter((line) => (line.body.MarkedLines?.length ?? 0) > 0)
          .map((line) => line.lineNumber),
      },
      payload: this.logPayloads.captureExchange(requestBody),
    });
  }

  /**
   * Record the bulk response and the per-line error correlation so a failed
   * journal line can be traced back to the line it was built from.
   */
  private async logCashBulkOutcome(args: {
    headerKey: string;
    pendingLines: CashBulkPendingLine[];
    attempt: CashBulkAttempt;
    batch: CashBulkBatch;
    result: TSLedgerJournalTransCustomBulkResponseBody | null | undefined;
    failures: CashBulkLineFailure[];
  }): Promise<void> {
    const { headerKey, pendingLines, attempt, batch, result, failures } = args;
    const succeeded = failures.length === 0;

    await this.operationalLogs.emit({
      level: succeeded ? 'info' : 'error',
      message: succeeded
        ? `Cash-out bulk request ${batch.number}/${batch.total} for journal ${headerKey} accepted ${pendingLines.length} line(s)`
        : `Cash-out bulk request ${batch.number}/${batch.total} for journal ${headerKey} failed for ${failures.length} line(s)`,
      context: CustomerPaymentJournalService.name,
      eventType: 'd365fo.cash-out.bulk-response',
      status: succeeded ? 'accepted' : 'rejected',
      metadata: {
        journalNum: headerKey,
        attempt,
        requestNumber: batch.number,
        requestCount: batch.total,
        lineCount: pendingLines.length,
        lineNumbers: pendingLines.map((line) => line.lineNumber),
        failedLineNumbers: failures
          .map((failure) => failure.lineNumber)
          .filter(
            (lineNumber): lineNumber is number => lineNumber !== undefined,
          ),
        uncorrelatedFailureCount: failures.filter(
          (failure) => !failure.correlated,
        ).length,
        failures: failures.map((failure) => ({
          lineNumber: failure.lineNumber ?? null,
          requestIndex: failure.requestIndex,
          correlated: failure.correlated,
          message: failure.message,
        })),
        settlementIntent: pendingLines.some(
          (line) => (line.body.MarkedLines?.length ?? 0) > 0,
        )
          ? 'MARKED'
          : 'UNMARKED',
        settlementVerificationStatus: succeeded
          ? 'PENDING_VERIFICATION'
          : 'SKIPPED',
      },
      payload: this.logPayloads.captureExchange(undefined, result ?? null),
    });
  }

  /**
   * Project an internal cash line onto a `_contract.Lines` entry.
   *
   * The X++ constructor performs unconditional map lookups for the core line
   * members, so those keys are always emitted (with empty values where the
   * contract permits them). Cash-In always emits MarkedLines as an array so
   * its request shape is stable. Cash-Out preserves its existing optional
   * MarkedLines behavior. Legacy aliases are never forwarded.
   */
  private toD365BulkCashLine(
    line: TSLedgerJournalTransCustomRequestBody,
    cashDirection: 'in' | 'out' = 'out',
  ): TSLedgerJournalTransCustomBulkLineRequestBody {
    const accountType = this.normalizeCustomAccountType(line.accountTypeStr);
    const offsetAccountType = this.normalizeCustomAccountType(
      line.OffsetAccountTypeStr,
    );
    const resolvedVendorGroup =
      String(line.VendorGroup ?? '').trim() ||
      (accountType === 'Vendor' &&
      (line.MarkedLines ?? []).some(
        (markedLine) =>
          !String(markedLine.InvoiceNumber ?? '').trim() &&
          Boolean(String(markedLine.DocumentNumber ?? '').trim()) &&
          Boolean(String(markedLine.OperationNumber ?? '').trim()),
      )
        ? 'Custody'
        : '');

    const markedLines = (line.MarkedLines ?? []).map((markedLine) => ({
      InvoiceNumber: String(markedLine.InvoiceNumber ?? ''),
      OperationNumber: String(markedLine.OperationNumber ?? ''),
      DocumentNumber: String(markedLine.DocumentNumber ?? ''),
      HasWithHoldingLine: Boolean(markedLine.HasWithHoldingLine),
      ...(markedLine.FullSettlement !== undefined
        ? { FullSettlement: Boolean(markedLine.FullSettlement) }
        : {}),
    }));

    return {
      JournalNum: String(line.journalNum ?? ''),
      AccountNum: String(line.AccountNum ?? ''),
      AccountTypeStr: accountType,
      BANKTRANSACTIONTYPE: String(line.BANKTRANSACTIONTYPE ?? ''),
      CENTRALBANKPURPOSECODE: String(line.CENTRALBANKPURPOSECODE ?? ''),
      CENTRALBANKPURPOSETEXT: String(line.CENTRALBANKPURPOSETEXT ?? ''),
      Company: String(line.company ?? ''),
      CreditAmount: Number(line.creditAmount ?? 0),
      Currency: String(line.currency ?? ''),
      DebitAmount: Number(line.debitAmount ?? 0),
      DEFAULTDIMENSIONDISPLAYVALUE: String(
        line.DEFAULTDIMENSIONDISPLAYVALUE ?? '',
      ),
      OffsetDEFAULTDIMENSIONDISPLAYVALUE: String(
        line.offsetDEFAULTDIMENSIONDISPLAYVALUE ?? '',
      ),
      FinTagStr: String(line.FinTagStr ?? ''),
      ISPREPAYMENT: String(line.ISPREPAYMENT ?? 'No'),
      ITEMWITHHOLDINGTAXGROUP: String(line.ITEMWITHHOLDINGTAXGROUP ?? ''),
      OffsetAccountDisplayValue: String(line.offsetAccountDisplayValue ?? ''),
      OffsetAccountTypeStr: offsetAccountType,
      OffsetCompany: String(line.OffsetCompany ?? ''),
      OFFSETFINTAGDISPLAYVALUE: String(line.OFFSETFINTAGDISPLAYVALUE ?? ''),
      OFFSETTRANSACTIONTEXT: String(line.OFFSETTRANSACTIONTEXT ?? ''),
      PAYMENTID: String(line.PAYMENTID ?? ''),
      PAYMENTMETHODNAME: String(line.PAYMENTMETHODNAME ?? ''),
      PAYMENTNOTES: String(line.PAYMENTNOTES ?? ''),
      PAYMENTREFERENCE: String(line.PAYMENTREFERENCE ?? ''),
      PAYMENTSPECIFICATION: String(line.PAYMENTSPECIFICATION ?? ''),
      PostingProfile: String(line.PostingProfile ?? ''),
      TaxGroup: String(line.TaxGroup ?? ''),
      TAXITEMGROUP: String(line.TAXITEMGROUP ?? ''),
      TransDate: String(line.transDate ?? ''),
      TRANSACTIONTEXT: String(line.TRANSACTIONTEXT ?? ''),
      DocumentDate: String(line.DocumentDate ?? ''),
      DocumentNum: String(line.DocumentNum ?? ''),
      ExchangeRate: this.firstNumericValue(
        line.ExchangeRate,
        line.ExchRate,
        line.EXCHANGERATE,
      ),
      ReportingExchangeRate: this.firstNumericValue(
        line.ReportingExchangeRate,
        line.ReportingCurrencyExchRate,
        line.REPORTINGEXCHANGERATE,
      ),
      ...(resolvedVendorGroup ? { VendorGroup: resolvedVendorGroup } : {}),
      ...(cashDirection === 'in'
        ? { MarkedLines: markedLines }
        : markedLines.length > 0
          ? { MarkedLines: markedLines }
          : {}),
    };
  }

  private normalizeCustomAccountType(
    value: unknown,
  ): TSLedgerJournalTransCustomBulkLineRequestBody['AccountTypeStr'] {
    const normalized =
      typeof value === 'string' || typeof value === 'number'
        ? String(value).trim().toLowerCase()
        : '';
    if (normalized === 'cust') return 'Cust';
    if (normalized === 'vend' || normalized === 'vendor') return 'Vendor';
    if (normalized === 'bank') return 'Bank';
    if (normalized === 'rcash' || normalized === 'pettycash') return 'RCash';
    if (normalized === 'ledger') return 'Ledger';
    return '';
  }

  private firstNumericValue(...values: unknown[]): number {
    const value = values
      .map((candidate) =>
        candidate === null || candidate === undefined
          ? Number.NaN
          : Number(candidate),
      )
      .find((candidate) => Number.isFinite(candidate));
    return value ?? 0;
  }

  /**
   * List all lines for a specific header from D365FO
   */
  public async listLinesForHeader(
    headerKey: string,
    dataAreaId: string,
  ): Promise<Array<{ LineNumber: number }>> {
    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', dataAreaId),
      this.queryBuilder.eq('JournalBatchNumber', headerKey),
    );

    const query = this.queryBuilder.buildQuery(
      '/data/CustomerPaymentJournalLines',
      {
        filter,
        select: ['LineNumber'],
        crossCompany: true,
      },
    );

    const response = await this.d365foClient.get<{ LineNumber: number }>(
      query,
      { useCache: false },
    );

    return response.value || [];
  }

  /**
   * Post a single customer payment journal line (with retry for concurrency conflicts)
   */
  public async postLine(
    data: D365FOCustomerPaymentJournalLineRequest,
  ): Promise<unknown> {
    this.logger.debug(
      `Posting customer payment journal line for company: ${data.dataAreaId}, line: ${data.LineNumber}`,
    );

    return this.retryService.executeWithRetry(
      async () => {
        return await this.d365foClient.post<
          D365FOCustomerPaymentJournalLineRequest,
          unknown
        >('/data/CustomerPaymentJournalLines', data);
      },
      {
        retries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryCondition: (error: unknown) => {
          if (!(error as any)?.response) return true;
          const status = (error as any).response?.status;
          if (status && status >= 500) return true;
          return (
            this.dfoErrorExtractor.normalize(error).isConcurrencyConflict ===
            true
          );
        },
      },
    );
  }

  /**
   * Post multiple customer payment journal headers in chunks
   */
  public async postHeadersBatch(
    headers: D365FOCustomerPaymentJournalHeaderRequest[],
    chunkSize: number = 10,
  ): Promise<string[]> {
    const journalBatchNumbers: string[] = [];

    for (let i = 0; i < headers.length; i += chunkSize) {
      const chunk = headers.slice(i, i + chunkSize);
      const chunkPromises = chunk.map((header) => this.postHeader(header));
      const chunkResults = await Promise.all(chunkPromises);

      for (const result of chunkResults) {
        if (result?.JournalBatchNumber) {
          journalBatchNumbers.push(result.JournalBatchNumber);
        }
      }
    }

    return journalBatchNumbers;
  }

  /**
   * Delete a customer payment journal header (for rollback)
   */
  public async deleteHeader(
    journalBatchNumber: string,
    dataAreaId: string,
  ): Promise<void> {
    this.logger.debug(
      `[DELETE] Deleting customer payment journal header ${journalBatchNumber} for company: ${dataAreaId}`,
    );

    const endpoint = `/data/CustomerPaymentJournalHeaders(dataAreaId='${dataAreaId}',JournalBatchNumber='${journalBatchNumber}')?cross-company=true`;

    await this.retryService.executeWithRetry(
      async () => {
        await this.d365foClient.delete(endpoint);
      },
      {
        retries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryCondition: (error: unknown) => {
          if (!(error as any)?.response) return true;
          const status = (error as any).response?.status;
          if (status && status >= 500) return true;
          return (
            this.dfoErrorExtractor.normalize(error).isConcurrencyConflict ===
            true
          );
        },
      },
    );
  }

  /**
   * Delete a customer payment journal line (for rollback)
   */
  public async deleteLine(
    journalBatchNumber: string,
    lineNumber: number,
    dataAreaId: string,
  ): Promise<void> {
    this.logger.debug(
      `[DELETE] Deleting customer payment journal line ${lineNumber} for journal ${journalBatchNumber} in company: ${dataAreaId}`,
    );

    const endpoint = `/data/CustomerPaymentJournalLines(dataAreaId='${dataAreaId}',JournalBatchNumber='${journalBatchNumber}',LineNumber=${lineNumber})?cross-company=true`;

    await this.retryService.executeWithRetry(
      async () => {
        await this.d365foClient.delete(endpoint);
      },
      {
        retries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryCondition: (error: unknown) => {
          if (!(error as any)?.response) return true;
          const status = (error as any).response?.status;
          if (status && status >= 500) return true;
          return (
            this.dfoErrorExtractor.normalize(error).isConcurrencyConflict ===
            true
          );
        },
      },
    );
  }
}
