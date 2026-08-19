import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { D365FOClientService } from './d365fo-client.service';
import { DfoErrorExtractorService } from './dfo-error-extractor.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';
import {
  VendorInvoiceJournalService,
  VendorPaymentSettlementVerification,
} from './vendor-invoice-journal.service';
import { VendorPaymentJournalService } from './vendor-payment-journal.service';

import { IConfig, ResilienceConfig } from '@/config';
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

export type CashJournalExistingLinesLoader = () => Promise<
  Array<{ LineNumber: number }>
>;

interface CashBulkPendingLine {
  lineNumber: number;
  body: TSLedgerJournalTransCustomRequestBody;
}

interface CashBulkLineFailure {
  requestIndex: number;
  lineNumber?: number;
  message: string;
  correlated: boolean;
}

type CashBulkAttempt = 'initial';

/** Position of one request within the journal batch it belongs to. */
interface CashBulkBatch {
  number: number;
  total: number;
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

  /**
   * Journal lines sent per cash-out request. All lines of a journal batch go
   * out through the `Lines` collection, split into requests of this size so a
   * large journal stays inside the endpoint's request size and timeout limits.
   */
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
    return this.postCashLinesForHeader(
      headerKey,
      lines,
      chunkSize,
      dataAreaId,
      'in',
      existingLinesLoader,
      allowUnmarkedInvoiceRetry,
    );
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
    return this.postCashLinesForHeader(
      headerKey,
      lines,
      chunkSize,
      dataAreaId,
      'out',
      existingLinesLoader,
      allowUnmarkedInvoiceRetry,
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
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const endpoint =
      cashDirection === 'in'
        ? this.cashInLineEndpoint
        : this.cashOutLineEndpoint;

    this.logger.log(
      cashDirection === 'out'
        ? `[CASH-CUSTOM] Preparing ${lines.length} cash-out lines for header ${headerKey} in bulk requests of up to ${this.cashOutBulkBatchSize} lines`
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
        if (existingLinesLoader) {
          throw new Error(
            `[CASH-CUSTOM] Could not verify existing lines for routed header ${headerKey}; posting was stopped to prevent duplicates: ${lookupError}`,
          );
        }
        this.logger.warn(
          `[CASH-CUSTOM] Could not query existing lines for header ${headerKey}: ${lookupError}`,
        );
      }
    }

    const successfullyPosted: Array<{
      headerId: string;
      lineNumber: number;
    }> = [];

    if (cashDirection === 'out') {
      return this.postCashOutBulkLinesForHeader(
        endpoint,
        headerKey,
        lines,
        existingLines,
        dataAreaId || lines[0]?.dataAreaId || '',
        allowUnmarkedInvoiceRetry,
      );
    }

    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.log(
        `[CASH-CUSTOM] Processing chunk ${chunkNumber}/${totalChunks} for header ${headerKey} (${chunk.length} lines)`,
      );

      for (const line of chunk) {
        const body = line.customLineApiBody;
        if (!body) {
          throw new Error(
            `Missing customLineApiBody on cash-${cashDirection} line ${line.LineNumber}`,
          );
        }

        if (existingLines.has(line.LineNumber)) {
          successfullyPosted.push({
            headerId: headerKey,
            lineNumber: line.LineNumber,
          });
          continue;
        }

        try {
          await this.postCustomCashLine(endpoint, {
            ...body,
            journalNum: headerKey,
          });
        } catch (error) {
          const errorDetails = this.dfoErrorExtractor.extractMessage(error);

          if (
            allowUnmarkedInvoiceRetry &&
            this.isInvoiceAmountGreaterThanRemainingError(errorDetails)
          ) {
            await this.postCustomCashLine(
              endpoint,
              this.buildUnmarkedCashLine({
                ...body,
                journalNum: headerKey,
              }),
            );
            successfullyPosted.push({
              headerId: headerKey,
              lineNumber: line.LineNumber,
            });
            continue;
          }

          this.logger.error(
            `[CASH-CUSTOM] Failed to post cash-${cashDirection} line ${line.LineNumber} for header ${headerKey}: ${errorDetails}`,
            error instanceof Error ? error.stack : undefined,
          );
          throw new Error(
            `Failed to post cash-${cashDirection} line ${line.LineNumber} for header ${headerKey}: ${errorDetails}`,
          );
        }

        successfullyPosted.push({
          headerId: headerKey,
          lineNumber: line.LineNumber,
        });
        if (line !== chunk[chunk.length - 1]) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    }

    return successfullyPosted;
  }

  private async postCashOutBulkLinesForHeader(
    endpoint: string,
    headerKey: string,
    lines: D365FOCustomerPaymentJournalLineRequest[],
    existingLines: Set<number>,
    dataAreaId: string,
    allowUnmarkedInvoiceRetry: boolean,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const pendingLines: CashBulkPendingLine[] = [];

    for (const line of lines) {
      if (existingLines.has(line.LineNumber)) continue;

      const body = line.customLineApiBody;
      if (!body) {
        throw new Error(
          `Missing customLineApiBody on cash-out line ${line.LineNumber}`,
        );
      }

      const suppliedJournalNumber = String(body.journalNum ?? '').trim();
      if (suppliedJournalNumber && suppliedJournalNumber !== headerKey) {
        throw new Error(
          `Cash-out line ${line.LineNumber} belongs to journal ${suppliedJournalNumber}, not ${headerKey}`,
        );
      }

      pendingLines.push({
        lineNumber: line.LineNumber,
        body: { ...body, journalNum: headerKey },
      });
    }

    const batchSize = this.cashOutBulkBatchSize;
    const totalBatches = Math.ceil(pendingLines.length / batchSize);

    for (let index = 0; index < pendingLines.length; index += batchSize) {
      await this.postCashOutBulkBatch(
        endpoint,
        headerKey,
        pendingLines.slice(index, index + batchSize),
        dataAreaId,
        allowUnmarkedInvoiceRetry,
        { number: Math.floor(index / batchSize) + 1, total: totalBatches },
      );
    }

    return lines.map((line) => ({
      headerId: headerKey,
      lineNumber: line.LineNumber,
    }));
  }

  /**
   * Submit one request holding up to {@link cashOutBulkBatchSize} lines of the
   * journal batch and fail closed on any D365 rejection.
   *
   * Cash-out vendor-payment posting must preserve the original settlement
   * intent. Infrastructure never rewrites a marked payment into an unmarked one.
   */
  private async postCashOutBulkBatch(
    endpoint: string,
    headerKey: string,
    pendingLines: CashBulkPendingLine[],
    dataAreaId: string,
    _allowUnmarkedInvoiceRetry: boolean,
    batch: CashBulkBatch,
  ): Promise<void> {
    if (pendingLines.length === 0) return;

    this.logger.log(
      `[CASH-CUSTOM] Submitting ${pendingLines.length} cash-out lines in request ${batch.number}/${batch.total} for header ${headerKey}`,
    );

    const result = await this.postCustomCashLines(
      endpoint,
      pendingLines.map((line) => line.body),
      { headerKey, pendingLines, attempt: 'initial', batch },
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
      await this.verifyCashOutMarkedSettlements(
        headerKey,
        pendingLines,
        dataAreaId,
        batch,
      );
      return;
    }
    throw new Error(this.formatCashBulkFailure(headerKey, failures));
  }

  /**
   * Map a FO bulk response onto the lines we submitted.
   *
   * Live `TSAddLedgerJournalResponse` is all-or-nothing (one TTS): only overall
   * StatusCode/Message are set. A remaining-invoice-amount error is attributed
   * to every submitted line so the unmarked retry can clear settlements for the
   * whole chunk. Optional per-line arrays are parsed only when FO returns them.
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
    if (this.isInvoiceAmountGreaterThanRemainingError(message)) {
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
  ): string {
    const details = failures
      .map((failure) =>
        failure.lineNumber === undefined
          ? failure.message
          : `line ${failure.lineNumber}: ${failure.message}`,
      )
      .join('; ');
    return `Failed to post cash-out lines for header ${headerKey}: ${details}`;
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

  private appendUnmarkedDescription(description: string): string {
    const trimmed = String(description ?? '').trim();
    if (!trimmed) return 'unmarked';
    if (trimmed.toLowerCase().includes('unmarked')) return trimmed;
    return `${trimmed} - unmarked`;
  }

  private buildUnmarkedCashLine(
    body: TSLedgerJournalTransCustomRequestBody,
  ): TSLedgerJournalTransCustomRequestBody {
    const retryBody = { ...body };
    if (Array.isArray(retryBody.MarkedLines)) retryBody.MarkedLines = [];
    if ('MARKEDINVOICE' in retryBody) retryBody.MARKEDINVOICE = null;
    retryBody.PAYMENTNOTES = this.appendUnmarkedDescription(
      retryBody.PAYMENTNOTES,
    );
    retryBody.TRANSACTIONTEXT = this.appendUnmarkedDescription(
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
      >(endpoint, { _contract: body });

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
  ): Promise<TSLedgerJournalTransCustomBulkResponseBody> {
    const requestBody: TSLedgerJournalTransCustomBulkRequest = {
      _contract: {
        Lines: lines.map((line) => this.toD365BulkCashLine(line)),
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
  ): Promise<void> {
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

    if (verificationTargets.length === 0) return;

    const verification = await this.pollCashOutSettlementVerification(
      dataAreaId,
      headerKey,
      verificationTargets,
    );
    await this.logCashSettlementVerification(headerKey, batch, verification);

    const failures = verification.filter(
      (result) => result.status !== 'VERIFIED',
    );
    if (failures.length === 0) return;

    throw new Error(
      `Cash-out journal ${headerKey} was accepted by D365, but settlement verification failed: ${failures
        .map((failure) => `line ${failure.lineNumber}: ${failure.reason}`)
        .join('; ')}`,
    );
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
        maxLinesPerRequest: this.cashOutBulkBatchSize,
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
   * Scenario 4 (main account-only): offset account *data* is omitted by sending
   * empty Offset* values. The keys themselves stay on every line because FO's
   * `constructFromJsonObject` calls `jsonMap.lookup(...)` without `exists()`
   * for most members (including VendorGroup / Offset*) and throws
   * `The value "…" is not found in the map.` when a key is absent.
   * Lowercase `offset*` aliases are stripped so they cannot collide with the
   * PascalCase keys FO actually reads.
   */
  private toD365BulkCashLine(
    line: TSLedgerJournalTransCustomRequestBody,
  ): TSLedgerJournalTransCustomBulkLineRequestBody {
    const {
      offsetDEFAULTDIMENSIONDISPLAYVALUE: _omitOffsetDimAlias,
      offsetAccountDisplayValue: _omitOffsetAccountAlias,
      accountTypeStr,
      VendorGroup,
      ...rest
    } = line;

    return {
      ...rest,
      accountTypeStr: String(accountTypeStr ?? '')
        .trim()
        .toLowerCase() as TSLedgerJournalTransCustomBulkLineRequestBody['accountTypeStr'],
      // Always present: X++ does jsonMap.lookup("VendorGroup") unconditionally.
      VendorGroup: VendorGroup ?? '',
      OffsetDEFAULTDIMENSIONDISPLAYVALUE:
        line.offsetDEFAULTDIMENSIONDISPLAYVALUE ?? '',
      OffsetAccountDisplayValue: line.offsetAccountDisplayValue ?? '',
      OffsetAccountTypeStr: line.OffsetAccountTypeStr ?? '',
      OffsetCompany: line.OffsetCompany ?? '',
      OFFSETFINTAGDISPLAYVALUE: line.OFFSETFINTAGDISPLAYVALUE ?? '',
      OFFSETTRANSACTIONTEXT: line.OFFSETTRANSACTIONTEXT ?? '',
    };
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
