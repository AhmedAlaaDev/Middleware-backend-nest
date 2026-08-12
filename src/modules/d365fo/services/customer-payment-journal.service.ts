import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { D365FOClientService } from './d365fo-client.service';
import { DfoErrorExtractorService } from './dfo-error-extractor.service';
import { GeneralJournalService } from './general-journal.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';
import { VendorInvoiceJournalService } from './vendor-invoice-journal.service';
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

type CashBulkAttempt =
  | 'initial'
  | 'marked-retry-after-clear'
  | 'unmarked-retry';

interface MarkedSettlementBlocker {
  journalBatchNumber: string;
  company: string;
}

/** Position of one request within the journal batch it belongs to. */
interface CashBulkBatch {
  number: number;
  total: number;
}

/** A ledger line whose sales tax groups are applied after the line exists. */
interface DeferredLedgerTax {
  company: string;
  paymentId: string;
  currency: string;
  debitAmount: number;
  creditAmount: number;
  taxGroup: string;
  taxItemGroup: string;
}

interface CashCustomMainAccountAlias {
  alias: string;
  name: string;
}

interface D365FOMainAccountAliasRecord {
  MainAccountId?: string;
  Name?: string;
  ChartOfAccounts?: string;
}

export interface ExpectedVendorInvoiceSettlement {
  lineNumber: number;
  invoiceNumber: string;
  vendorAccount: string;
  currency: string;
  settlementAmount: number;
}

export interface CashOutSettlementIntegrityResult {
  matches: boolean;
  expectedCount: number;
  actualCount: number;
  missing: ExpectedVendorInvoiceSettlement[];
  unexpected: Array<{
    lineNumber: number;
    invoiceNumber: string;
    journalBatchNumber: string;
  }>;
  blockers: Array<{
    expectedLineNumber: number;
    invoiceNumber: string;
    journalBatchNumber: string;
    journalLineNumber: number;
    journalLineCompany: string;
  }>;
  repaired: Array<{ lineNumber: number; invoiceNumber: string }>;
  repairErrors: Array<{
    lineNumber: number;
    invoiceNumber: string;
    message: string;
  }>;
}

const CASH_CUSTOM_MAIN_ACCOUNT_ALIASES: readonly CashCustomMainAccountAlias[] =
  [
    { alias: 'WCA-US', name: 'WCApp - USD' },
    { alias: 'WCA-USD', name: 'WCApp - USD' },
    { alias: 'WCA-EU', name: 'WCApp - EUR' },
    { alias: 'WCA-EUR', name: 'WCApp - EUR' },
  ];

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
   * Max UniqueId groups (balanced entry chunks) per cash-out bulk request.
   * Every FO line that shares the same PAYMENTID / UniqueId is kept in the
   * same request so each bulk body stays a set of complete balanced groups.
   */
  private readonly cashOutBulkBatchSize = 100;

  /** Axios timeout for cash-out bulk custom-service POSTs (see D365FO_BULK_HTTP_TIMEOUT). */
  private readonly cashOutBulkHttpTimeout: number;

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
    private readonly retryService: RetryService,
    private readonly dfoErrorExtractor: DfoErrorExtractorService,
    private readonly vendorInvoiceJournalService: VendorInvoiceJournalService,
    private readonly vendorPaymentJournalService: VendorPaymentJournalService,
    private readonly generalJournalService: GeneralJournalService,
    private readonly operationalLogs: OperationalLoggerService,
    private readonly logPayloads: LogPayloadService,
    configService: ConfigService<IConfig>,
  ) {
    this.cashOutBulkHttpTimeout =
      configService.get<ResilienceConfig>('resilience')?.bulkHttpTimeout ??
      1_200_000;
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
    allowUnmarkedInvoiceRetry = true,
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
      `[CASH-CUSTOM] Preparing ${lines.length} cash-${cashDirection} lines for header ${headerKey} in bulk requests of up to ${this.cashOutBulkBatchSize} UniqueId group(s)`,
    );

    // Older batches can already contain WCA-US / WCA-EUR in their persisted
    // custom body. Resolve those aliases at posting time as well as for new
    // batches, so retrying an existing journal uses the current D365 main
    // account setup without requiring a re-upload.
    let normalizedLines = await this.resolveCashCustomMainAccountAliases(
      lines,
      dataAreaId,
    );

    if (cashDirection === 'out') {
      normalizedLines = await this.resolveCashCustomMarkedInvoiceIds(
        normalizedLines,
        dataAreaId,
      );
    }

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

    // Both CustPaym and VendPaym expect `{ _contract: { Lines: [...] } }`.
    // A flat single-line `_contract` makes FO return "No journal lines were received."
    return this.postCashBulkLinesForHeader(
      endpoint,
      headerKey,
      normalizedLines,
      existingLines,
      dataAreaId,
      allowUnmarkedInvoiceRetry,
      cashDirection,
    );
  }

  /**
   * D365 settlement compares InvoiceNumber exactly, including surrounding
   * spaces. Resolve the normalized invoice/vendor pair through the posted
   * invoice entity, then send the exact InvoiceId returned by Finance. This is
   * intentionally done during posting so Resume/Retry also fixes old batches.
   */
  private async resolveCashCustomMarkedInvoiceIds(
    lines: D365FOCustomerPaymentJournalLineRequest[],
    dataAreaId?: string,
  ): Promise<D365FOCustomerPaymentJournalLineRequest[]> {
    const company =
      String(dataAreaId ?? '').trim() ||
      String(
        lines.find((line) => line.customLineApiBody?.company)?.customLineApiBody
          ?.company ?? '',
      ).trim();
    if (!company) return lines;

    const invoices = lines.flatMap((line) => {
      const markedLines = line.customLineApiBody?.MarkedLines;
      if (!Array.isArray(markedLines)) return [];
      return markedLines
        .map((marked) => String(marked?.InvoiceNumber ?? ''))
        .filter((invoice) => Boolean(invoice.trim()));
    });
    if (invoices.length === 0) return lines;

    const exactInvoiceIds =
      await this.vendorInvoiceJournalService.findExistingInvoiceVendorPairInvoiceIds(
        company,
        invoices,
      );
    if (exactInvoiceIds.size === 0) return lines;

    let replacements = 0;
    const resolvedLines = lines.map((line) => {
      const body = line.customLineApiBody;
      if (!body || !Array.isArray(body.MarkedLines)) return line;

      const vendorAccount = String(body.AccountNum ?? '');
      let bodyChanged = false;
      const markedLines = body.MarkedLines.map((marked) => {
        const sourceInvoiceId = String(marked?.InvoiceNumber ?? '');
        if (!sourceInvoiceId.trim() || !vendorAccount.trim()) return marked;

        const exactInvoiceId = exactInvoiceIds.get(
          VendorInvoiceJournalService.pairKey(sourceInvoiceId, vendorAccount),
        );
        if (
          exactInvoiceId === undefined ||
          exactInvoiceId === sourceInvoiceId
        ) {
          return marked;
        }

        replacements += 1;
        bodyChanged = true;
        return { ...marked, InvoiceNumber: exactInvoiceId };
      });

      if (!bodyChanged) return line;
      return {
        ...line,
        customLineApiBody: { ...body, MarkedLines: markedLines },
      };
    });

    if (replacements > 0) {
      this.logger.log(
        `[CASH-CUSTOM] Replaced ${replacements} marked invoice value(s) with the exact InvoiceId stored in D365`,
      );
    }

    return resolvedLines;
  }

  /**
   * Verify the authoritative Finance settlement child rows against the marks
   * requested by middleware. If the custom X++ service silently leaves a mark
   * out and no other journal owns it, repair only that child record. Monetary
   * journal lines are never reposted by this method.
   */
  public async verifyCashOutSettlementIntegrity(
    headerKey: string,
    lines: D365FOCustomerPaymentJournalLineRequest[],
    dataAreaId: string,
    repairMissing = true,
  ): Promise<CashOutSettlementIntegrityResult> {
    const expected = this.expectedVendorInvoiceSettlements(lines);
    if (expected.length === 0) {
      return {
        matches: true,
        expectedCount: 0,
        actualCount: 0,
        missing: [],
        unexpected: [],
        blockers: [],
        repaired: [],
        repairErrors: [],
      };
    }

    let actual = await this.loadActualVendorInvoiceSettlements(
      headerKey,
      dataAreaId,
    );
    let comparison = this.compareVendorInvoiceSettlements(
      headerKey,
      expected,
      actual,
    );
    const repaired: Array<{ lineNumber: number; invoiceNumber: string }> = [];
    const repairErrors: Array<{
      lineNumber: number;
      invoiceNumber: string;
      message: string;
    }> = [];

    let blockers = await this.findVendorInvoiceSettlementBlockers(
      headerKey,
      dataAreaId,
      comparison.missing,
    );

    if (repairMissing && comparison.missing.length > 0) {
      const blockedKeys = new Set(
        blockers.map((blocker) =>
          this.settlementKey(blocker.expectedLineNumber, blocker.invoiceNumber),
        ),
      );
      for (const missing of comparison.missing) {
        if (
          blockedKeys.has(
            this.settlementKey(missing.lineNumber, missing.invoiceNumber),
          )
        ) {
          continue;
        }
        try {
          await this.repairMissingVendorInvoiceSettlement(
            headerKey,
            dataAreaId,
            missing,
          );
          repaired.push({
            lineNumber: missing.lineNumber,
            invoiceNumber: missing.invoiceNumber,
          });
        } catch (error) {
          repairErrors.push({
            lineNumber: missing.lineNumber,
            invoiceNumber: missing.invoiceNumber,
            message: this.dfoErrorExtractor.extractMessage(error),
          });
        }
      }

      actual = await this.loadActualVendorInvoiceSettlements(
        headerKey,
        dataAreaId,
      );
      comparison = this.compareVendorInvoiceSettlements(
        headerKey,
        expected,
        actual,
      );
      blockers = await this.findVendorInvoiceSettlementBlockers(
        headerKey,
        dataAreaId,
        comparison.missing,
      );
    }

    return {
      matches:
        comparison.missing.length === 0 && comparison.unexpected.length === 0,
      expectedCount: expected.length,
      actualCount: actual.length,
      missing: comparison.missing,
      unexpected: comparison.unexpected,
      blockers,
      repaired,
      repairErrors,
    };
  }

  public async assertCashOutSettlementIntegrity(
    headerKey: string,
    lines: D365FOCustomerPaymentJournalLineRequest[],
    dataAreaId: string,
  ): Promise<void> {
    const result = await this.verifyCashOutSettlementIntegrity(
      headerKey,
      lines,
      dataAreaId,
      true,
    );
    if (result.matches) return;

    const details: string[] = [];
    for (const missing of result.missing) {
      const blocker = result.blockers.find(
        (candidate) =>
          candidate.expectedLineNumber === missing.lineNumber &&
          this.normalizeSettlementInvoice(candidate.invoiceNumber) ===
            this.normalizeSettlementInvoice(missing.invoiceNumber),
      );
      details.push(
        blocker
          ? `line ${missing.lineNumber} expected invoice ${missing.invoiceNumber}, but it is already marked by ${blocker.journalBatchNumber} line ${blocker.journalLineNumber} in ${blocker.journalLineCompany}`
          : `line ${missing.lineNumber} expected invoice ${missing.invoiceNumber}, but Finance left it unmarked`,
      );
    }
    for (const unexpected of result.unexpected) {
      details.push(
        `line ${unexpected.lineNumber} unexpectedly marks invoice ${unexpected.invoiceNumber}`,
      );
    }
    throw new Error(
      `[DATA INTEGRITY] Journal ${headerKey} invoice settlement mismatch (${result.actualCount}/${result.expectedCount} expected mark(s) confirmed): ${details.join('; ')}. No monetary journal lines were reposted.`,
    );
  }

  private expectedVendorInvoiceSettlements(
    lines: D365FOCustomerPaymentJournalLineRequest[],
  ): ExpectedVendorInvoiceSettlement[] {
    const expected = new Map<string, ExpectedVendorInvoiceSettlement>();
    for (const line of lines) {
      const body = line.customLineApiBody;
      const markedLines = body?.MarkedLines;
      if (!body || !Array.isArray(markedLines)) continue;
      for (const marked of markedLines) {
        const invoiceNumber = String(marked?.InvoiceNumber ?? '');
        if (!invoiceNumber.trim()) continue;
        const item: ExpectedVendorInvoiceSettlement = {
          lineNumber: Number(line.LineNumber),
          invoiceNumber,
          vendorAccount: String(body.AccountNum ?? ''),
          currency: String(body.currency ?? ''),
          settlementAmount:
            (Number(body.creditAmount) || 0) - (Number(body.debitAmount) || 0),
        };
        expected.set(
          this.settlementKey(item.lineNumber, item.invoiceNumber),
          item,
        );
      }
    }
    return [...expected.values()];
  }

  /** Combine the two settlement representations exposed by this D365FO build. */
  private async loadActualVendorInvoiceSettlements(
    headerKey: string,
    dataAreaId: string,
  ): Promise<
    Array<{
      JournalLineNumber: number;
      InvoiceNumber: string;
      JournalBatchNumber: string;
    }>
  > {
    const [journalLines, childRows] = await Promise.all([
      this.vendorPaymentJournalService.listIntegrityLinesForHeader(
        headerKey,
        dataAreaId,
      ),
      this.vendorPaymentJournalService.listSettledInvoicesForHeader(
        headerKey,
        dataAreaId,
      ),
    ]);
    const actual = new Map<
      string,
      {
        JournalLineNumber: number;
        InvoiceNumber: string;
        JournalBatchNumber: string;
      }
    >();

    // The custom cash X++ service stores successful selections directly on
    // the journal line (MarkedInvoice + SettleVoucher).
    for (const line of journalLines) {
      const invoiceNumber = String(line.MarkedInvoice ?? '');
      if (!invoiceNumber.trim()) continue;
      const item = {
        JournalLineNumber: Number(line.LineNumber),
        InvoiceNumber: invoiceNumber,
        JournalBatchNumber: headerKey,
      };
      actual.set(
        this.settlementKey(item.JournalLineNumber, item.InvoiceNumber),
        item,
      );
    }

    // Standard OData-created settlement selections can instead appear as
    // child rows. Include them without double counting the journal-line mark.
    for (const child of childRows) {
      const item = {
        JournalLineNumber: Number(child.JournalLineNumber),
        InvoiceNumber: String(child.InvoiceNumber ?? ''),
        JournalBatchNumber: String(child.JournalBatchNumber ?? headerKey),
      };
      actual.set(
        this.settlementKey(item.JournalLineNumber, item.InvoiceNumber),
        item,
      );
    }
    return [...actual.values()];
  }

  private compareVendorInvoiceSettlements(
    headerKey: string,
    expected: ExpectedVendorInvoiceSettlement[],
    actual: Array<{
      JournalLineNumber: number;
      InvoiceNumber: string;
      JournalBatchNumber: string;
    }>,
  ): {
    missing: ExpectedVendorInvoiceSettlement[];
    unexpected: Array<{
      lineNumber: number;
      invoiceNumber: string;
      journalBatchNumber: string;
    }>;
  } {
    const expectedKeys = new Set(
      expected.map((item) =>
        this.settlementKey(item.lineNumber, item.invoiceNumber),
      ),
    );
    const actualKeys = new Set(
      actual.map((item) =>
        this.settlementKey(item.JournalLineNumber, item.InvoiceNumber),
      ),
    );
    return {
      missing: expected.filter(
        (item) =>
          !actualKeys.has(
            this.settlementKey(item.lineNumber, item.invoiceNumber),
          ),
      ),
      unexpected: actual
        .filter(
          (item) =>
            !expectedKeys.has(
              this.settlementKey(item.JournalLineNumber, item.InvoiceNumber),
            ),
        )
        .map((item) => ({
          lineNumber: Number(item.JournalLineNumber),
          invoiceNumber: String(item.InvoiceNumber ?? ''),
          journalBatchNumber: String(item.JournalBatchNumber ?? headerKey),
        })),
    };
  }

  private async findVendorInvoiceSettlementBlockers(
    headerKey: string,
    dataAreaId: string,
    missing: ExpectedVendorInvoiceSettlement[],
  ): Promise<CashOutSettlementIntegrityResult['blockers']> {
    if (missing.length === 0) return [];
    const owners =
      await this.vendorPaymentJournalService.listSettlementOwnersForInvoices(
        dataAreaId,
        missing.map((item) => item.invoiceNumber),
      );
    const blockers: CashOutSettlementIntegrityResult['blockers'] = [];
    for (const item of missing) {
      const invoice = this.normalizeSettlementInvoice(item.invoiceNumber);
      for (const owner of owners) {
        if (
          owner.JournalBatchNumber === headerKey ||
          this.normalizeSettlementInvoice(owner.InvoiceNumber) !== invoice ||
          (owner.invoiceAccount &&
            String(owner.invoiceAccount).trim().toLowerCase() !==
              item.vendorAccount.trim().toLowerCase())
        ) {
          continue;
        }
        blockers.push({
          expectedLineNumber: item.lineNumber,
          invoiceNumber: owner.InvoiceNumber,
          journalBatchNumber: owner.JournalBatchNumber,
          journalLineNumber: Number(owner.JournalLineNumber),
          journalLineCompany: owner.JournalLineCompany,
        });
      }
    }
    return blockers;
  }

  private async repairMissingVendorInvoiceSettlement(
    headerKey: string,
    dataAreaId: string,
    missing: ExpectedVendorInvoiceSettlement,
  ): Promise<void> {
    const variants = [
      missing.invoiceNumber,
      missing.invoiceNumber.trim(),
      ` ${missing.invoiceNumber.trim()}`,
      `${missing.invoiceNumber.trim()} `,
      ` ${missing.invoiceNumber.trim()} `,
    ];
    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', dataAreaId),
      this.queryBuilder.eq('AccountNum', missing.vendorAccount),
      `(${this.queryBuilder.or(
        ...[...new Set(variants)].map((invoice) =>
          this.queryBuilder.eq('Invoice', invoice),
        ),
      )})`,
    );
    const query = this.queryBuilder.buildQuery('/data/VendTransBiEntities', {
      filter,
      select: [
        'Invoice',
        'AccountNum',
        'AmountCur',
        'SettleAmountCur',
        'CurrencyCode',
        'DueDate',
        'Closed',
      ],
      top: 20,
      crossCompany: true,
    });
    const response = await this.d365foClient.get<{
      Invoice: string;
      AccountNum: string;
      AmountCur: number;
      SettleAmountCur: number;
      CurrencyCode: string;
      DueDate: string;
      Closed: string;
    }>(query, { useCache: false });
    const invoice = (response.value ?? []).find(
      (row) =>
        this.normalizeSettlementInvoice(row.Invoice) ===
        this.normalizeSettlementInvoice(missing.invoiceNumber),
    );
    if (!invoice) {
      throw new Error(
        `posted vendor invoice ${missing.invoiceNumber} / ${missing.vendorAccount} was not found`,
      );
    }
    const available = Math.abs(
      (Number(invoice.AmountCur) || 0) - (Number(invoice.SettleAmountCur) || 0),
    );
    const requested = Math.abs(missing.settlementAmount);
    if (available + 0.01 < requested) {
      throw new Error(
        `invoice ${missing.invoiceNumber} has ${available} ${invoice.CurrencyCode} remaining, below requested ${requested} ${missing.currency}`,
      );
    }
    if (
      missing.currency &&
      invoice.CurrencyCode &&
      missing.currency.trim().toUpperCase() !==
        invoice.CurrencyCode.trim().toUpperCase()
    ) {
      throw new Error(
        `invoice ${missing.invoiceNumber} currency ${invoice.CurrencyCode} does not match payment currency ${missing.currency}`,
      );
    }

    await this.vendorPaymentJournalService.addSettledInvoice({
      JournalLineCompany: dataAreaId,
      JournalBatchNumber: headerKey,
      JournalLineNumber: missing.lineNumber,
      InvoiceNumber: invoice.Invoice,
      InvoiceCompany: dataAreaId,
      InvoiceDueDate: invoice.DueDate,
      InvoiceToPaymentCrossRate: 0,
      SettlementAmountInInvoiceCurrency: missing.settlementAmount,
      CashDiscountToTakeInInvoiceCurrency: 0,
    });
  }

  private settlementKey(lineNumber: number, invoiceNumber: string): string {
    return `${Number(lineNumber)}|${this.normalizeSettlementInvoice(invoiceNumber)}`;
  }

  private normalizeSettlementInvoice(value: unknown): string {
    return String(value ?? '')
      .replace(
        /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g,
        '',
      )
      .replace(/\u00a0/g, ' ')
      .normalize('NFKC')
      .trim()
      .toLowerCase();
  }

  /**
   * D365 stores the WCA accounts as ledger main accounts named `WCApp - USD`
   * and `WCApp - EUR`, while source files can provide aliases such as
   * `WCA-US` and `WCA-EUR`. The custom API must receive the main-account ID
   * with account type Ledger; sending the alias as Bank makes FO query
   * BankAccountTable and fail with "No record ... exists".
   */
  private async resolveCashCustomMainAccountAliases(
    lines: D365FOCustomerPaymentJournalLineRequest[],
    _dataAreaId?: string,
  ): Promise<D365FOCustomerPaymentJournalLineRequest[]> {
    const aliasesByValue = new Map(
      CASH_CUSTOM_MAIN_ACCOUNT_ALIASES.map((entry) => [
        this.normalizeCashCustomAccountAlias(entry.alias),
        entry,
      ]),
    );

    const requestedAliases = new Set<string>();
    for (const line of lines) {
      const body = line.customLineApiBody;
      if (!body) continue;

      if (String(body.OffsetAccountTypeStr ?? '').toLowerCase() === 'bank') {
        const alias = this.normalizeCashCustomAccountAlias(
          body.offsetAccountDisplayValue,
        );
        if (aliasesByValue.has(alias)) requestedAliases.add(alias);
      }

      if (String(body.accountTypeStr ?? '').toLowerCase() === 'bank') {
        const alias = this.normalizeCashCustomAccountAlias(body.AccountNum);
        if (aliasesByValue.has(alias)) requestedAliases.add(alias);
      }
    }

    if (requestedAliases.size === 0) return lines;

    const targetNamesForQuery = Array.from(
      new Set(
        Array.from(requestedAliases).map(
          (alias) => aliasesByValue.get(alias)!.name,
        ),
      ),
    );
    const targetNames = new Set(
      targetNamesForQuery.map((name) =>
        this.normalizeCashCustomMainAccountName(name),
      ),
    );
    // Finance rejects contains(Name, ...) on this entity with
    // "The type 'System.String' for the query operator is not Queryable".
    // Match the exact values used by MainAccounts, including the legacy
    // leading-space variant visible in Dynamics.
    const nameFilter = targetNamesForQuery
      .flatMap((name) => [
        this.queryBuilder.eq('Name', name),
        this.queryBuilder.eq('Name', ` ${name}`),
      ])
      .join(' or ');
    const query = this.queryBuilder.buildQuery('/data/MainAccounts', {
      filter: nameFilter,
      select: ['MainAccountId', 'Name', 'ChartOfAccounts'],
      top: 100,
      crossCompany: true,
    });

    const response = await this.d365foClient.get<D365FOMainAccountAliasRecord>(
      query,
      { useCache: true, cacheTtl: 60 * 60 * 1000 },
    );
    const records = Array.isArray(response?.value) ? response.value : [];
    const mainAccountIdsByName = new Map<string, Set<string>>();

    for (const record of records) {
      const name = this.normalizeCashCustomMainAccountName(record.Name);
      const accountId = String(record.MainAccountId ?? '').trim();
      if (!name || !accountId || !targetNames.has(name)) continue;

      const accountIds = mainAccountIdsByName.get(name) ?? new Set<string>();
      accountIds.add(accountId);
      mainAccountIdsByName.set(name, accountIds);
    }

    const resolvedByAlias = new Map<string, string>();
    for (const alias of requestedAliases) {
      const target = aliasesByValue.get(alias)!;
      const accountIds = mainAccountIdsByName.get(
        this.normalizeCashCustomMainAccountName(target.name),
      );
      if (!accountIds || accountIds.size === 0) {
        throw new Error(
          `[CASH-CUSTOM] Could not resolve bank alias ${target.alias}: D365 main account "${target.name}" was not found.`,
        );
      }
      if (accountIds.size > 1) {
        throw new Error(
          `[CASH-CUSTOM] Could not resolve bank alias ${target.alias}: D365 returned multiple main accounts for "${target.name}" (${Array.from(accountIds).join(', ')}).`,
        );
      }
      resolvedByAlias.set(alias, Array.from(accountIds)[0]);
    }

    return lines.map((line) => {
      const body = line.customLineApiBody;
      if (!body) return line;

      const normalizedBody = { ...body };
      if (String(body.OffsetAccountTypeStr ?? '').toLowerCase() === 'bank') {
        const alias = this.normalizeCashCustomAccountAlias(
          body.offsetAccountDisplayValue,
        );
        const mainAccountId = resolvedByAlias.get(alias);
        if (mainAccountId) {
          normalizedBody.offsetAccountDisplayValue = mainAccountId;
          normalizedBody.OffsetAccountTypeStr = 'Ledger';
        }
      }

      if (String(body.accountTypeStr ?? '').toLowerCase() === 'bank') {
        const alias = this.normalizeCashCustomAccountAlias(body.AccountNum);
        const mainAccountId = resolvedByAlias.get(alias);
        if (mainAccountId) {
          normalizedBody.AccountNum = mainAccountId;
          normalizedBody.accountTypeStr = 'Ledger';
        }
      }

      return { ...line, customLineApiBody: normalizedBody };
    });
  }

  private normalizeCashCustomAccountAlias(value: unknown): string {
    return (
      typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : ''
    )
      .trim()
      .toUpperCase()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-');
  }

  private normalizeCashCustomMainAccountName(value: unknown): string {
    return (
      typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : ''
    )
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase();
  }

  private async postCashBulkLinesForHeader(
    endpoint: string,
    headerKey: string,
    lines: D365FOCustomerPaymentJournalLineRequest[],
    existingLines: Set<number>,
    dataAreaId: string | undefined,
    allowUnmarkedInvoiceRetry: boolean,
    cashDirection: 'in' | 'out',
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const preparedLines: CashBulkPendingLine[] = [];
    const directionLabel = `cash-${cashDirection}`;

    for (const line of lines) {
      const body = line.customLineApiBody;
      if (!body) {
        throw new Error(
          `Missing customLineApiBody on ${directionLabel} line ${line.LineNumber}`,
        );
      }

      const suppliedJournalNumber = String(body.journalNum ?? '').trim();
      if (suppliedJournalNumber && suppliedJournalNumber !== headerKey) {
        throw new Error(
          `${directionLabel} line ${line.LineNumber} belongs to journal ${suppliedJournalNumber}, not ${headerKey}`,
        );
      }

      preparedLines.push({
        lineNumber: line.LineNumber,
        body: { ...body, journalNum: headerKey },
      });
    }

    const uniqueIdBatches = this.chunkCashOutLinesByUniqueIdGroups(
      preparedLines,
      this.cashOutBulkBatchSize,
    );
    const totalBatches = uniqueIdBatches.length;
    const pendingPreparedLines = preparedLines.filter(
      (line) => !existingLines.has(line.lineNumber),
    );

    await this.repairPartialUniqueIdGroups(
      headerKey,
      dataAreaId,
      cashDirection,
      preparedLines,
      pendingPreparedLines,
      existingLines,
    );

    const resumablePendingLines = preparedLines.filter(
      (line) => !existingLines.has(line.lineNumber),
    );

    // A resumed post may skip an entire UniqueId group that FO already has,
    // but it must never post only the missing part of a group. That would turn
    // a source-balanced entry into an unbalanced request.
    this.assertCompleteUniqueIdGroupSelection(
      preparedLines,
      resumablePendingLines,
      `resume journal ${headerKey}`,
    );
    const alreadyPostedCount = preparedLines.filter((line) =>
      existingLines.has(line.lineNumber),
    ).length;

    if (alreadyPostedCount > 0) {
      const resumePatch =
        uniqueIdBatches.findIndex((batchLines) =>
          batchLines.some((line) => !existingLines.has(line.lineNumber)),
        ) + 1;
      this.logger.log(
        `[CASH-CUSTOM] Resuming ${directionLabel} for header ${headerKey}: ${alreadyPostedCount}/${preparedLines.length} line(s) already posted in FO; starting from patch ${resumePatch > 0 ? resumePatch : Math.max(totalBatches, 1)}/${Math.max(totalBatches, 1)} (${totalBatches} UniqueId-group request(s))`,
      );
    }

    // Walk UniqueId-group windows so already-posted FO patches stay skipped and
    // retry continues at the first window that still has pending lines. A
    // UniqueId's lines are never split across requests.
    for (
      let batchIndex = 0;
      batchIndex < uniqueIdBatches.length;
      batchIndex++
    ) {
      const patchNumber = batchIndex + 1;
      const patchLines = uniqueIdBatches[batchIndex];
      const pendingLines = patchLines.filter(
        (line) => !existingLines.has(line.lineNumber),
      );
      const uniqueIdGroupCount = this.countUniqueIdGroups(patchLines);

      if (pendingLines.length === 0) {
        this.logger.log(
          `[CASH-CUSTOM] Skipping ${directionLabel} patch ${patchNumber}/${totalBatches} for header ${headerKey}: all ${patchLines.length} line(s) across ${uniqueIdGroupCount} UniqueId group(s) already posted`,
        );
        continue;
      }

      if (pendingLines.length !== patchLines.length) {
        this.logger.log(
          `[CASH-CUSTOM] ${directionLabel} patch ${patchNumber}/${totalBatches} for header ${headerKey}: posting ${pendingLines.length}/${patchLines.length} remaining line(s) across ${this.countUniqueIdGroups(pendingLines)} UniqueId group(s)`,
        );
      }

      await this.postCashOutBulkBatch(
        endpoint,
        headerKey,
        pendingLines,
        allowUnmarkedInvoiceRetry,
        { number: patchNumber, total: totalBatches },
      );
    }

    return lines.map((line) => ({
      headerId: headerKey,
      lineNumber: line.LineNumber,
    }));
  }

  /**
   * Pack prepared FO lines into bulk requests of at most `maxGroups` UniqueId
   * groups. Lines that share PAYMENTID (the source UniqueId) always travel
   * together so each request is a set of complete balanced entry groups.
   */
  private chunkCashOutLinesByUniqueIdGroups(
    preparedLines: CashBulkPendingLine[],
    maxGroups: number,
  ): CashBulkPendingLine[][] {
    if (preparedLines.length === 0) return [];
    if (maxGroups < 1) {
      throw new Error(
        `cashOutBulkBatchSize must be at least 1 UniqueId group; received ${maxGroups}`,
      );
    }

    const groups = this.groupCashOutLinesByUniqueId(preparedLines);

    const batches: CashBulkPendingLine[][] = [];
    for (let index = 0; index < groups.length; index += maxGroups) {
      batches.push(groups.slice(index, index + maxGroups).flat());
    }
    return batches;
  }

  private groupCashOutLinesByUniqueId(
    lines: CashBulkPendingLine[],
  ): CashBulkPendingLine[][] {
    const groups: CashBulkPendingLine[][] = [];
    const groupIndexByKey = new Map<string, number>();

    for (const line of lines) {
      const key = this.resolveCashOutUniqueIdGroupKey(line);
      const existingIndex = groupIndexByKey.get(key);
      if (existingIndex === undefined) {
        groupIndexByKey.set(key, groups.length);
        groups.push([line]);
      } else {
        groups[existingIndex].push(line);
      }
    }

    return groups;
  }

  /**
   * Verify that `selectedLines` contains either every line or no line from
   * each UniqueId group in `allLines`. This protects both resume and retry
   * requests from splitting a balanced source entry.
   */
  private assertCompleteUniqueIdGroupSelection(
    allLines: CashBulkPendingLine[],
    selectedLines: CashBulkPendingLine[],
    operation: string,
  ): void {
    const partialGroups = this.findPartialUniqueIdGroups(
      allLines,
      selectedLines,
    );

    if (partialGroups.length === 0) return;

    const details = partialGroups
      .map(
        (group) =>
          `${group.key} (${group.selectedCount}/${group.totalCount} line(s) selected)`,
      )
      .join(', ');
    throw new Error(
      `[CASH-CUSTOM] Cannot ${operation}: the request would split complete UniqueId group(s): ${details}. Recreate or roll back the affected journal before retrying.`,
    );
  }

  private findPartialUniqueIdGroups(
    allLines: CashBulkPendingLine[],
    selectedLines: CashBulkPendingLine[],
  ): Array<{
    key: string;
    lines: CashBulkPendingLine[];
    selectedCount: number;
    totalCount: number;
  }> {
    const selectedLineNumbers = new Set(
      selectedLines.map((line) => line.lineNumber),
    );

    return this.groupCashOutLinesByUniqueId(allLines)
      .map((lines) => ({
        key: this.resolveCashOutUniqueIdGroupKey(lines[0]),
        lines,
        selectedCount: lines.filter((line) =>
          selectedLineNumbers.has(line.lineNumber),
        ).length,
        totalCount: lines.length,
      }))
      .filter(
        (group) =>
          group.selectedCount > 0 && group.selectedCount < group.totalCount,
      );
  }

  /**
   * Recover a retry after a bulk request left only part of a UniqueId group in
   * Finance. Delete only those partial-group lines, then let the normal flow
   * repost the complete group. Fully posted groups remain untouched.
   */
  private async repairPartialUniqueIdGroups(
    headerKey: string,
    dataAreaId: string | undefined,
    cashDirection: 'in' | 'out',
    allLines: CashBulkPendingLine[],
    selectedLines: CashBulkPendingLine[],
    existingLines: Set<number>,
  ): Promise<void> {
    const partialGroups = this.findPartialUniqueIdGroups(
      allLines,
      selectedLines,
    );
    if (partialGroups.length === 0) return;

    if (!dataAreaId) {
      this.assertCompleteUniqueIdGroupSelection(
        allLines,
        selectedLines,
        `resume journal ${headerKey}`,
      );
      return;
    }

    const partialLineNumbers = partialGroups
      .flatMap((group) => group.lines)
      .filter((line) => existingLines.has(line.lineNumber))
      .map((line) => line.lineNumber);

    this.logger.warn(
      `[CASH-CUSTOM] Repairing ${partialLineNumbers.length} existing line(s) from partial UniqueId group(s) before resuming journal ${headerKey}: ${partialGroups.map((group) => `${group.key} (${group.selectedCount}/${group.totalCount})`).join(', ')}`,
    );

    for (const lineNumber of partialLineNumbers) {
      if (cashDirection === 'out') {
        await this.vendorPaymentJournalService.deleteLine(
          headerKey,
          lineNumber,
          dataAreaId,
        );
      } else {
        await this.deleteLine(headerKey, lineNumber, dataAreaId);
      }
      existingLines.delete(lineNumber);
    }
  }

  private resolveCashOutUniqueIdGroupKey(line: CashBulkPendingLine): string {
    const paymentId = String(
      line.body.PAYMENTID ??
        (line.body as { PaymentId?: string }).PaymentId ??
        '',
    ).trim();
    // Missing PAYMENTID must not merge unrelated lines into one fake group.
    return paymentId || `__line:${line.lineNumber}`;
  }

  private countUniqueIdGroups(lines: CashBulkPendingLine[]): number {
    return new Set(
      lines.map((line) => this.resolveCashOutUniqueIdGroupKey(line)),
    ).size;
  }

  /**
   * Repair the exact corruption produced by the D365 custom vendor-payment
   * service when one successful request creates a marked set followed by an
   * unmarked fallback set. No deletion occurs unless every row in the second
   * half is proven to be the fallback twin of the corresponding first row.
   */
  public async repairDuplicatedUnmarkedFallbackLines(
    headerKey: string,
    expectedLineCount: number,
    dataAreaId: string,
  ): Promise<boolean> {
    if (expectedLineCount < 1) return false;
    const lines = (
      await this.vendorPaymentJournalService.listIntegrityLinesForHeader(
        headerKey,
        dataAreaId,
      )
    ).sort((left, right) => Number(left.LineNumber) - Number(right.LineNumber));
    if (lines.length !== expectedLineCount * 2) return false;

    const retained = lines.slice(0, expectedLineCount);
    const fallback = lines.slice(expectedLineCount);
    for (let index = 0; index < expectedLineCount; index++) {
      if (
        Number(fallback[index].LineNumber) !==
          Number(retained[index].LineNumber) + expectedLineCount ||
        !this.isProvenUnmarkedFallbackTwin(retained[index], fallback[index])
      ) {
        return false;
      }
    }

    const fallbackLineNumbers = fallback.map((line) => Number(line.LineNumber));
    this.logger.warn(
      `[CASH-CUSTOM] Repairing D365 successful-response duplication on journal ${headerKey}: retaining ${expectedLineCount} original line(s) and deleting ${fallbackLineNumbers.length} proven unmarked fallback twin(s).`,
    );
    for (let start = 0; start < fallbackLineNumbers.length; start += 5) {
      await Promise.all(
        fallbackLineNumbers
          .slice(start, start + 5)
          .map((lineNumber) =>
            this.vendorPaymentJournalService.deleteLine(
              headerKey,
              lineNumber,
              dataAreaId,
            ),
          ),
      );
    }

    const remaining = await this.vendorPaymentJournalService.listLinesForHeader(
      headerKey,
      dataAreaId,
    );
    if (remaining.length !== expectedLineCount) {
      throw new Error(
        `[DATA INTEGRITY] Journal ${headerKey} fallback cleanup was incomplete: expected ${expectedLineCount} retained line(s), found ${remaining.length}.`,
      );
    }
    return true;
  }

  private isProvenUnmarkedFallbackTwin(
    retained: Record<string, unknown> & { LineNumber: number },
    fallback: Record<string, unknown> & { LineNumber: number },
  ): boolean {
    const retainedLineNumber = Number(retained.LineNumber);
    const fallbackLineNumber = Number(fallback.LineNumber);
    if (
      !Number.isFinite(retainedLineNumber) ||
      !Number.isFinite(fallbackLineNumber)
    ) {
      return false;
    }
    if (fallbackLineNumber <= retainedLineNumber) return false;
    if (this.integrityString(fallback.MarkedInvoice).trim()) return false;

    const comparableFields = [
      'AccountDisplayValue',
      'AccountType',
      'OffsetAccountDisplayValue',
      'OffsetAccountType',
      'CurrencyCode',
      'DebitAmount',
      'CreditAmount',
      'PaymentId',
      'PaymentReference',
      'FinTagDisplayValue',
      'OffsetFinTagDisplayValue',
      'PostingProfile',
      'TransactionDate',
    ];
    if (
      comparableFields.some(
        (field) =>
          this.normalizeIntegrityValue(retained[field]) !==
          this.normalizeIntegrityValue(fallback[field]),
      )
    ) {
      return false;
    }

    const retainedText = this.integrityString(retained.TransactionText).trim();
    const fallbackText = this.integrityString(fallback.TransactionText).trim();
    const retainedInvoice = this.integrityString(retained.MarkedInvoice).trim();
    return retainedInvoice
      ? fallbackText === `${retainedText} unmarked with ${retainedInvoice}`
      : fallbackText === retainedText &&
          fallbackText.includes(' unmarked with ');
  }

  private normalizeIntegrityValue(value: unknown): string {
    if (typeof value === 'number') return value.toFixed(6);
    return this.integrityString(value)
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private integrityString(value: unknown): string {
    return typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
      ? String(value)
      : '';
  }

  /**
   * Submit one request holding complete UniqueId groups (at most
   * {@link cashOutBulkBatchSize} groups). Retries when FO rejects because
   * (a) a prior journal still holds SpecTrans marks, or (b) a marked invoice
   * no longer covers the paid amount.
   */
  private async postCashOutBulkBatch(
    endpoint: string,
    headerKey: string,
    pendingLines: CashBulkPendingLine[],
    allowUnmarkedInvoiceRetry: boolean,
    batch: CashBulkBatch,
  ): Promise<void> {
    if (pendingLines.length === 0) return;

    this.logger.log(
      `[CASH-CUSTOM] Submitting ${pendingLines.length} cash line(s) across ${this.countUniqueIdGroups(pendingLines)} UniqueId group(s) in request ${batch.number}/${batch.total} for header ${headerKey}`,
    );

    const result = await this.postCustomCashLines(
      endpoint,
      pendingLines.map((line) => line.body),
      { headerKey, pendingLines, attempt: 'initial', batch },
    );
    let failures = this.extractCashBulkFailures(result, pendingLines);
    await this.logCashBulkOutcome({
      endpoint,
      headerKey,
      pendingLines,
      attempt: 'initial',
      batch,
      result,
      failures,
    });

    if (failures.length === 0) {
      return this.applyDeferredLedgerTax(headerKey, pendingLines);
    }

    let activeLines = pendingLines;

    if (
      allowUnmarkedInvoiceRetry &&
      this.areAllFailuresAlreadyMarkedForSettlement(failures)
    ) {
      failures = await this.recoverAlreadyMarkedCashOutBulk({
        endpoint,
        headerKey,
        pendingLines: activeLines,
        batch,
        failures,
      });
      if (failures.length === 0) {
        return this.applyDeferredLedgerTax(headerKey, activeLines);
      }
    }

    const retryableFailures = failures.filter((failure) =>
      this.isCashOutSettlementRetryableError(failure.message),
    );
    // Vendor Payment / invoice settlement: never strip MarkedLines just because
    // FO rejected the remaining invoice amount. Posting unmarked would hide the
    // settlement failure and leave journals without SpecTrans marks. SpecTrans
    // "already marked" recovery may still fall through to unmarked below.
    const preserveSettlementMarks =
      this.bulkLinesHaveSettlementMarks(activeLines) &&
      failures.every((failure) =>
        this.isInvoiceAmountGreaterThanRemainingError(failure.message),
      );
    const canUnmarkedRetry =
      allowUnmarkedInvoiceRetry &&
      !preserveSettlementMarks &&
      retryableFailures.length === failures.length &&
      failures.every((failure) => failure.correlated);

    if (canUnmarkedRetry) {
      const retryLines = retryableFailures.map((failure) => {
        const pendingLine = activeLines[failure.requestIndex];
        return {
          ...pendingLine,
          body: this.buildUnmarkedCashLine(pendingLine.body),
        };
      });
      this.assertCompleteUniqueIdGroupSelection(
        activeLines,
        retryLines,
        `retry request ${batch.number}/${batch.total} for journal ${headerKey} without invoice marks`,
      );
      activeLines = retryLines;
      const retryResult = await this.postCustomCashLines(
        endpoint,
        activeLines.map((line) => line.body),
        {
          headerKey,
          pendingLines: activeLines,
          attempt: 'unmarked-retry',
          batch,
        },
      );
      failures = this.extractCashBulkFailures(retryResult, activeLines);
      await this.logCashBulkOutcome({
        endpoint,
        headerKey,
        pendingLines: activeLines,
        attempt: 'unmarked-retry',
        batch,
        result: retryResult,
        failures,
      });
      if (failures.length === 0) {
        return this.applyDeferredLedgerTax(headerKey, activeLines);
      }
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

    // All-or-nothing TTS rolled the chunk back; attribute settlement-retryable
    // errors to every line so retries can recover the chunk.
    if (this.isCashOutSettlementRetryableError(message)) {
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
    return `Failed to post cash lines for header ${headerKey}: ${details}`;
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
    return normalized.includes('has been marked for settlement');
  }

  private isCashOutSettlementRetryableError(message: string): boolean {
    return (
      this.isInvoiceAmountGreaterThanRemainingError(message) ||
      this.isAlreadyMarkedForSettlementError(message)
    );
  }

  /** FO journal JSON date: `yyyy-MM-ddT00:00:00` (no Z / millis). */
  private normalizeFoJsonDate(value: string): string {
    const iso = String(value ?? '')
      .trim()
      .replace(/\.\d{3}Z$/, '')
      .replace(/Z$/, '');
    if (!iso) return '';
    const match = iso.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? `${match[1]}T00:00:00` : iso;
  }

  private ensureCashOutBulkLineDates(
    lines: TSLedgerJournalTransCustomRequestBody[],
  ): void {
    const fallback =
      lines
        .map(
          (line) =>
            this.normalizeFoJsonDate(String(line.transDate ?? '')) ||
            this.normalizeFoJsonDate(String(line.DocumentDate ?? '')),
        )
        .find((date) => Boolean(date)) ||
      `${new Date().toISOString().slice(0, 10)}T00:00:00`;

    for (const line of lines) {
      const transDate =
        this.normalizeFoJsonDate(String(line.transDate ?? '')) ||
        this.normalizeFoJsonDate(String(line.DocumentDate ?? '')) ||
        fallback;
      const documentDate =
        this.normalizeFoJsonDate(String(line.DocumentDate ?? '')) || transDate;
      line.transDate = transDate;
      line.DocumentDate = documentDate;
    }
  }

  private areAllFailuresAlreadyMarkedForSettlement(
    failures: CashBulkLineFailure[],
  ): boolean {
    return (
      failures.length > 0 &&
      failures.every(
        (failure) =>
          failure.correlated &&
          this.isAlreadyMarkedForSettlementError(failure.message),
      )
    );
  }

  /**
   * FO error shape:
   * "This transaction has been marked for settlement by Custody Settlement Mesco-000014128 in company m-p."
   */
  private parseMarkedSettlementBlocker(
    message: string,
  ): MarkedSettlementBlocker | null {
    const match = String(message ?? '').match(
      /marked for settlement by .+?\s+([A-Za-z0-9_-]+)\s+in company\s+([A-Za-z0-9_-]+)/i,
    );
    if (!match) return null;
    return {
      journalBatchNumber: match[1],
      company: match[2],
    };
  }

  /**
   * Clear FO SpecTrans marks left by prior cash-out attempts, then rematch.
   *
   * Where the marks come from: earlier `MarkedLines` posts to
   * `addLedgerJournalTransVendPaym` write SpecTrans rows that cite a journal.
   * Failed/partial TTS often leaves those rows behind.
   *
   * Recovery:
   * 1. Delete every *other* journal FO cites (if it still exists), rematch
   *    with MarkedLines.
   * 2. If marks cite *this* journal and the request still carries settlement
   *    MarkedLines: delete this journal (releases SpecTrans) and throw a
   *    missing-header error so the queue processor recreates a fresh journal
   *    and retries with MarkedLines. Do **not** fall back to unmarked — that
   *    posts the journal without settlement.
   * 3. If marks cite *this* journal but the lines have no settlement marks,
   *    fall through so the caller can unmarked-retry on the existing header.
   *
   * @returns remaining failures after rematch (empty = recovered).
   */
  private async recoverAlreadyMarkedCashOutBulk(args: {
    endpoint: string;
    headerKey: string;
    pendingLines: CashBulkPendingLine[];
    batch: CashBulkBatch;
    failures: CashBulkLineFailure[];
  }): Promise<CashBulkLineFailure[]> {
    const { endpoint, headerKey, pendingLines, batch, failures } = args;
    const headerKeyNorm = headerKey.trim().toLowerCase();
    const blockers = this.collectMarkedSettlementBlockers(failures);
    const otherBlockers = blockers.filter(
      (blocker) =>
        blocker.journalBatchNumber.trim().toLowerCase() !== headerKeyNorm,
    );
    const selfCitedBlocker = blockers.find(
      (blocker) =>
        blocker.journalBatchNumber.trim().toLowerCase() === headerKeyNorm,
    );
    const selfCited = Boolean(selfCitedBlocker);

    for (const blocker of otherBlockers) {
      this.logger.warn(
        `[CASH-CUSTOM] Clearing SpecTrans held by journal ${blocker.journalBatchNumber} in ${blocker.company} (from prior MarkedLines post)`,
      );
      await this.tryDeleteBlockingJournalHeader(
        blocker.company,
        blocker.journalBatchNumber,
      );
    }

    if (otherBlockers.length > 0 && !selfCited) {
      const rematchResult = await this.postCustomCashLines(
        endpoint,
        pendingLines.map((line) => line.body),
        {
          headerKey,
          pendingLines,
          attempt: 'marked-retry-after-clear',
          batch,
        },
      );
      const rematchFailures = this.extractCashBulkFailures(
        rematchResult,
        pendingLines,
      );
      await this.logCashBulkOutcome({
        endpoint,
        headerKey,
        pendingLines,
        attempt: 'marked-retry-after-clear',
        batch,
        result: rematchResult,
        failures: rematchFailures,
      });
      if (rematchFailures.length === 0) return [];
      if (!this.areAllFailuresAlreadyMarkedForSettlement(rematchFailures)) {
        return rematchFailures;
      }
    }

    if (selfCited && this.bulkLinesHaveSettlementMarks(pendingLines)) {
      const company =
        selfCitedBlocker?.company ||
        String(pendingLines[0]?.body?.company ?? '').trim();
      this.logger.warn(
        `[CASH-CUSTOM] SpecTrans cites the journal being posted (${headerKey}); deleting it to clear SpecTrans so the header can be recreated and rematched with MarkedLines`,
      );
      if (company) {
        await this.tryDeleteBlockingJournalHeader(company, headerKey);
      }
      // Queue processor recreates the header when it sees this shape, then
      // retries postLinesForHeader with the original MarkedLines intact.
      throw new Error(`Journal ${headerKey} was not found.`);
    }

    if (selfCited) {
      this.logger.warn(
        `[CASH-CUSTOM] SpecTrans cites the journal being posted (${headerKey}); lines have no settlement marks — falling back to unmarked retry`,
      );
    }

    return failures;
  }

  private collectMarkedSettlementBlockers(
    failures: CashBulkLineFailure[],
  ): MarkedSettlementBlocker[] {
    const blockers = new Map<string, MarkedSettlementBlocker>();
    for (const failure of failures) {
      const blocker = this.parseMarkedSettlementBlocker(failure.message);
      if (!blocker) continue;
      blockers.set(`${blocker.company}|${blocker.journalBatchNumber}`, blocker);
    }
    return [...blockers.values()];
  }

  /**
   * Delete a blocking journal only when it still exists in FO.
   * AP cash-out routes (Vendor Payment / Custody Settlement / Custody Issue)
   * live on VendorPaymentJournalHeaders; GL routes on LedgerJournalHeaders.
   * Blind DELETE on the wrong entity (or a ghost
   * SpecTrans journal) returns OData "No resources were found when selecting
   * for update" and pollutes admin logs even when caught.
   */
  private async tryDeleteBlockingJournalHeader(
    company: string,
    journalBatchNumber: string,
  ): Promise<boolean> {
    if (await this.ledgerJournalHeaderExists(company, journalBatchNumber)) {
      try {
        await this.deleteLedgerJournalWithDependentLines(
          company,
          journalBatchNumber,
        );
        this.logger.log(
          `[CASH-CUSTOM] Deleted ledger journal ${journalBatchNumber} in ${company}`,
        );
        return true;
      } catch (error) {
        if (this.isODataResourceMissingError(error)) {
          this.logger.debug(
            `[CASH-CUSTOM] Ledger journal ${journalBatchNumber} in ${company} already gone`,
          );
          return false;
        }
        throw new Error(
          `[CASH-CUSTOM] Could not safely delete ledger journal ${journalBatchNumber} in ${company}; no replacement journal was created: ${this.dfoErrorExtractor.extractMessage(error)}`,
        );
      }
    }

    if (
      await this.vendorPaymentJournalHeaderExists(company, journalBatchNumber)
    ) {
      try {
        await this.deleteVendorPaymentJournalWithDependentLines(
          journalBatchNumber,
          company,
        );
        this.logger.log(
          `[CASH-CUSTOM] Deleted vendor payment journal ${journalBatchNumber} in ${company}`,
        );
        return true;
      } catch (error) {
        if (this.isODataResourceMissingError(error)) {
          this.logger.debug(
            `[CASH-CUSTOM] Vendor payment journal ${journalBatchNumber} in ${company} already gone`,
          );
          return false;
        }
        throw new Error(
          `[CASH-CUSTOM] Could not safely delete vendor payment journal ${journalBatchNumber} in ${company}; no replacement journal was created: ${this.dfoErrorExtractor.extractMessage(error)}`,
        );
      }
    }

    if (
      await this.customerPaymentJournalHeaderExists(company, journalBatchNumber)
    ) {
      try {
        await this.deleteCustomerPaymentJournalWithDependentLines(
          journalBatchNumber,
          company,
        );
        this.logger.log(
          `[CASH-CUSTOM] Deleted customer payment journal ${journalBatchNumber} in ${company}`,
        );
        return true;
      } catch (error) {
        if (this.isODataResourceMissingError(error)) {
          this.logger.debug(
            `[CASH-CUSTOM] Customer payment journal ${journalBatchNumber} in ${company} already gone`,
          );
          return false;
        }
        throw new Error(
          `[CASH-CUSTOM] Could not safely delete customer payment journal ${journalBatchNumber} in ${company}; no replacement journal was created: ${this.dfoErrorExtractor.extractMessage(error)}`,
        );
      }
    }

    this.logger.debug(
      `[CASH-CUSTOM] No FO journal header ${journalBatchNumber} in ${company} to delete (SpecTrans ghost)`,
    );
    return false;
  }

  /**
   * Delete dependent lines before a GL header. Recreating a header while the
   * old one still exists leaves duplicate journals in Finance.
   */
  private async deleteLedgerJournalWithDependentLines(
    company: string,
    journalBatchNumber: string,
  ): Promise<void> {
    await this.deleteJournalHeaderWithLineCleanup({
      journalBatchNumber,
      listLines: () =>
        this.generalJournalService.getJournalLines(
          company,
          journalBatchNumber,
          { maxCount: 10_000, select: ['LineNumber'], useCache: false },
        ),
      deleteLine: (lineNumber) =>
        this.generalJournalService.deleteJournalLine(
          company,
          journalBatchNumber,
          lineNumber,
        ),
      deleteHeader: () =>
        this.generalJournalService.deleteJournalHeader(
          company,
          journalBatchNumber,
        ),
    });
  }

  /** Delete dependent AP lines before the Vendor Payment header. */
  private async deleteVendorPaymentJournalWithDependentLines(
    journalBatchNumber: string,
    company: string,
  ): Promise<void> {
    await this.deleteJournalHeaderWithLineCleanup({
      journalBatchNumber,
      listLines: () =>
        this.vendorPaymentJournalService.listLinesForHeader(
          journalBatchNumber,
          company,
        ),
      deleteLine: (lineNumber) =>
        this.vendorPaymentJournalService.deleteLine(
          journalBatchNumber,
          lineNumber,
          company,
        ),
      deleteHeader: () =>
        this.vendorPaymentJournalService.deleteHeader(
          journalBatchNumber,
          company,
        ),
    });
  }

  private async deleteJournalHeaderWithLineCleanup(args: {
    journalBatchNumber: string;
    listLines: () => Promise<Array<{ LineNumber: number }>>;
    deleteLine: (lineNumber: number) => Promise<void>;
    deleteHeader: () => Promise<void>;
  }): Promise<void> {
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const lines = await args.listLines();
      for (let offset = 0; offset < lines.length; offset += 20) {
        const chunk = lines.slice(offset, offset + 20);
        await Promise.all(
          chunk.map(async (line) => {
            try {
              await args.deleteLine(Number(line.LineNumber));
            } catch (error) {
              if (!this.isODataResourceMissingError(error)) throw error;
            }
          }),
        );
      }

      if (lines.length > 0) {
        this.logger.log(
          `[CASH-CUSTOM] Deleted ${lines.length} dependent line(s) from journal ${args.journalBatchNumber} before header cleanup`,
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      try {
        await args.deleteHeader();
        return;
      } catch (error) {
        if (this.isODataResourceMissingError(error)) return;
        if (attempt < maxAttempts && this.isDependentJournalLinesError(error)) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        throw error;
      }
    }
  }

  private isDependentJournalLinesError(error: unknown): boolean {
    const message = this.dfoErrorExtractor
      .extractMessage(error)
      .toLowerCase()
      .replace(/\s+/g, ' ');
    return (
      message.includes('dependent journal lines') ||
      (message.includes('dependent') && message.includes('lines exist'))
    );
  }

  private isODataResourceMissingError(error: unknown): boolean {
    const message = this.dfoErrorExtractor
      .extractMessage(error)
      .toLowerCase()
      .replace(/\s+/g, ' ');
    return (
      message.includes('no resources were found') ||
      message.includes('resource not found') ||
      message.includes('was not found') ||
      message.includes('does not exist') ||
      message.includes('not find entity')
    );
  }

  private async ledgerJournalHeaderExists(
    company: string,
    journalBatchNumber: string,
  ): Promise<boolean> {
    try {
      const headers = await this.generalJournalService.getJournalHeaders(
        company,
        {
          maxCount: 1,
          filters: this.queryBuilder.eq(
            'JournalBatchNumber',
            journalBatchNumber,
          ),
          select: ['JournalBatchNumber'],
        },
      );
      return Array.isArray(headers) && headers.length > 0;
    } catch (error) {
      this.logger.warn(
        `[CASH-CUSTOM] Could not probe ledger journal ${journalBatchNumber} in ${company}: ${this.dfoErrorExtractor.extractMessage(error)}`,
      );
      return false;
    }
  }

  private async customerPaymentJournalHeaderExists(
    company: string,
    journalBatchNumber: string,
  ): Promise<boolean> {
    try {
      return await this.headerExists(journalBatchNumber, company);
    } catch (error) {
      this.logger.warn(
        `[CASH-CUSTOM] Could not probe customer payment journal ${journalBatchNumber} in ${company}: ${this.dfoErrorExtractor.extractMessage(error)}`,
      );
      return false;
    }
  }

  /** Delete dependent AR lines before the Customer Payment header. */
  private async deleteCustomerPaymentJournalWithDependentLines(
    journalBatchNumber: string,
    company: string,
  ): Promise<void> {
    await this.deleteJournalHeaderWithLineCleanup({
      journalBatchNumber,
      listLines: () =>
        this.listLinesForHeader(
          journalBatchNumber,
          company,
        ),
      deleteLine: (lineNumber) =>
        this.deleteLine(
          journalBatchNumber,
          lineNumber,
          company,
        ),
      deleteHeader: () =>
        this.deleteHeader(
          journalBatchNumber,
          company,
        ),
    });
  }

  private async vendorPaymentJournalHeaderExists(
    company: string,
    journalBatchNumber: string,
  ): Promise<boolean> {
    try {
      const query = this.queryBuilder.buildQuery(
        '/data/VendorPaymentJournalHeaders',
        {
          filter: this.queryBuilder.and(
            this.queryBuilder.eq('dataAreaId', company),
            this.queryBuilder.eq('JournalBatchNumber', journalBatchNumber),
          ),
          top: 1,
          select: ['JournalBatchNumber'],
          crossCompany: true,
        },
      );
      const response = await this.d365foClient.get<{ value?: unknown[] }>(
        query,
      );
      return Array.isArray(response?.value) && response.value.length > 0;
    } catch (error) {
      this.logger.warn(
        `[CASH-CUSTOM] Could not probe vendor payment journal ${journalBatchNumber} in ${company}: ${this.dfoErrorExtractor.extractMessage(error)}`,
      );
      return false;
    }
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
    delete retryBody.MarkedLines;
    if ('MARKEDINVOICE' in retryBody) retryBody.MARKEDINVOICE = null;
    // Custody SpecTrans is often keyed by document; clear so FO cannot rematch
    // the same open transaction when MarkedLines are already omitted.
    retryBody.DocumentNum = '';
    retryBody.PAYMENTNOTES = this.appendUnmarkedDescription(
      retryBody.PAYMENTNOTES,
    );
    retryBody.TRANSACTIONTEXT = this.appendUnmarkedDescription(
      retryBody.TRANSACTIONTEXT,
    );
    return retryBody;
  }

  /** True when any line carries FO settlement marks (invoice / doc / operation). */
  private bulkLinesHaveSettlementMarks(
    pendingLines: CashBulkPendingLine[],
  ): boolean {
    return pendingLines.some((line) => this.lineHasSettlementMarks(line.body));
  }

  private lineHasSettlementMarks(
    body: TSLedgerJournalTransCustomRequestBody,
  ): boolean {
    if (!Array.isArray(body.MarkedLines) || body.MarkedLines.length === 0) {
      return false;
    }
    return body.MarkedLines.some(
      (marked) =>
        Boolean(String(marked?.InvoiceNumber ?? '').trim()) ||
        Boolean(String(marked?.DocumentNumber ?? '').trim()) ||
        Boolean(String(marked?.OperationNumber ?? '').trim()),
    );
  }

  /**
   * A ledger line that carries a sales tax group cannot be inserted through
   * `addLedgerJournalTransVendPaym`: FO converts the taxable amount into the
   * accounting currency with an unset date and rejects the whole request with
   * "An exchange rate cannot be found ... on exchange date ." The same line is
   * accepted without the tax groups, and the groups can be set afterwards over
   * OData, so tax is applied in a second phase.
   */
  private isDeferredLedgerTaxLine(line: {
    accountTypeStr?: string;
    TAXITEMGROUP?: string;
  }): boolean {
    return (
      String(line.accountTypeStr ?? '').toLowerCase() === 'ledger' &&
      Boolean(String(line.TAXITEMGROUP ?? '').trim())
    );
  }

  private withoutDeferredLedgerTax(
    line: TSLedgerJournalTransCustomBulkLineRequestBody,
  ): TSLedgerJournalTransCustomBulkLineRequestBody {
    if (!this.isDeferredLedgerTaxLine(line)) return line;
    return { ...line, TaxGroup: '', TAXITEMGROUP: '' };
  }

  /**
   * Second phase of {@link isDeferredLedgerTaxLine}: put the sales tax groups
   * back on the ledger lines FO just created.
   *
   * A failure here leaves posted lines without their tax groups, so it is
   * logged rather than thrown: throwing would send the caller into header
   * recreate/repost and duplicate the lines that did succeed.
   */
  private async applyDeferredLedgerTax(
    headerKey: string,
    pendingLines: CashBulkPendingLine[],
  ): Promise<void> {
    const deferred: DeferredLedgerTax[] = pendingLines
      .map((pendingLine) => pendingLine.body)
      .filter((body) => this.isDeferredLedgerTaxLine(body))
      .map((body) => ({
        company: String(body.company ?? ''),
        paymentId: String(body.PAYMENTID ?? ''),
        currency: String(body.currency ?? ''),
        debitAmount: Number(body.debitAmount ?? 0),
        creditAmount: Number(body.creditAmount ?? 0),
        taxGroup: String(body.TaxGroup ?? ''),
        taxItemGroup: String(body.TAXITEMGROUP ?? ''),
      }));

    if (deferred.length === 0) return;

    const dataAreaId = deferred[0].company;
    if (!dataAreaId) {
      this.logger.error(
        `[CASH-CUSTOM] Cannot apply sales tax groups on ${deferred.length} ledger line(s) of journal ${headerKey}: the lines carry no company`,
      );
      return;
    }

    try {
      const untaxed = await this.listUntaxedLedgerLines(headerKey, dataAreaId);
      const claimed = new Set<number>();

      for (const entry of deferred) {
        const match = untaxed.find(
          (row) =>
            !claimed.has(row.LineNumber) &&
            String(row.PaymentId ?? '') === entry.paymentId &&
            String(row.CurrencyCode ?? '') === entry.currency &&
            Number(row.DebitAmount ?? 0) === entry.debitAmount &&
            Number(row.CreditAmount ?? 0) === entry.creditAmount,
        );

        if (!match) {
          this.logger.error(
            `[CASH-CUSTOM] No untaxed ledger line of journal ${headerKey} matches payment ${entry.paymentId} (${entry.currency} ${entry.debitAmount}/${entry.creditAmount}); sales tax group ${entry.taxItemGroup} was not applied`,
          );
          continue;
        }

        claimed.add(match.LineNumber);
        await this.patchLedgerLineTax(headerKey, dataAreaId, match.LineNumber, {
          SalesTaxGroup: entry.taxGroup,
          ItemSalesTaxGroup: entry.taxItemGroup,
        });
      }
    } catch (error) {
      this.logger.error(
        `[CASH-CUSTOM] Could not apply sales tax groups on ${deferred.length} ledger line(s) of journal ${headerKey}: ${this.dfoErrorExtractor.extractMessage(error)}`,
      );
    }
  }

  private async listUntaxedLedgerLines(
    headerKey: string,
    dataAreaId: string,
  ): Promise<
    Array<{
      LineNumber: number;
      PaymentId?: string;
      CurrencyCode?: string;
      DebitAmount?: number;
      CreditAmount?: number;
    }>
  > {
    // AccountType is an enum FO refuses to compare in $filter (it silently
    // returns no rows), so the journal is fetched whole and narrowed here.
    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', dataAreaId),
      this.queryBuilder.eq('JournalBatchNumber', headerKey),
    );

    const query = this.queryBuilder.buildQuery('/data/LedgerJournalLines', {
      filter,
      select: [
        'LineNumber',
        'AccountType',
        'ItemSalesTaxGroup',
        'PaymentId',
        'CurrencyCode',
        'DebitAmount',
        'CreditAmount',
      ],
      crossCompany: true,
    });

    const response = await this.d365foClient.get<{
      LineNumber: number;
      AccountType?: string;
      ItemSalesTaxGroup?: string;
      PaymentId?: string;
      CurrencyCode?: string;
      DebitAmount?: number;
      CreditAmount?: number;
    }>(query, { useCache: false });

    return (response.value || []).filter(
      (row) =>
        String(row.AccountType ?? '') === 'Ledger' &&
        !String(row.ItemSalesTaxGroup ?? '').trim(),
    );
  }

  private async patchLedgerLineTax(
    headerKey: string,
    dataAreaId: string,
    lineNumber: number,
    body: { SalesTaxGroup: string; ItemSalesTaxGroup: string },
  ): Promise<void> {
    const endpoint = `/data/LedgerJournalLines(dataAreaId='${dataAreaId}',JournalBatchNumber='${headerKey}',LineNumber=${lineNumber})?cross-company=true`;

    await this.d365foClient.patch<typeof body, unknown>(endpoint, body, {
      headers: { 'If-Match': '*' },
    });

    this.logger.log(
      `[CASH-CUSTOM] Applied sales tax group ${body.ItemSalesTaxGroup} on ledger line ${lineNumber} of journal ${headerKey}`,
    );
  }

  private omitAccountingExchangeRateFields(
    body: TSLedgerJournalTransCustomRequestBody,
  ): TSLedgerJournalTransCustomRequestBody {
    const {
      ExchangeRate: _exchangeRate,
      EXCHANGERATE: _exchangerate,
      ExchRate: _exchRate,
      ...rest
    } = body;
    return rest;
  }

  private async postCustomCashLine(
    endpoint: string,
    body: TSLedgerJournalTransCustomRequestBody,
  ): Promise<TSLedgerJournalTransCustomResponseBody> {
    try {
      const result = await this.d365foClient.post<
        TSLedgerJournalTransCustomRequest,
        TSLedgerJournalTransCustomResponseBody
      >(endpoint, {
        _contract: this.omitAccountingExchangeRateFields(body),
      });

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
    this.ensureCashOutBulkLineDates(lines);
    const requestBody: TSLedgerJournalTransCustomBulkRequest = {
      _contract: {
        Lines: lines.map((line) =>
          this.withoutDeferredLedgerTax(this.toD365BulkCashLine(line)),
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
    const direction = this.resolveCashBulkDirection(endpoint);
    const label = direction === 'in' ? 'Cash-in' : 'Cash-out';

    await this.operationalLogs.emit({
      level: 'info',
      message: `${label} bulk request ${context.batch.number}/${context.batch.total} for journal ${context.headerKey} with ${lineCount} line(s)`,
      context: CustomerPaymentJournalService.name,
      eventType: `d365fo.cash-${direction}.bulk-request`,
      status: 'submitted',
      metadata: {
        endpoint,
        cashDirection: direction,
        journalNum: context.headerKey,
        attempt: context.attempt,
        requestNumber: context.batch.number,
        requestCount: context.batch.total,
        maxUniqueIdGroupsPerRequest: this.cashOutBulkBatchSize,
        uniqueIdGroupCount: this.countUniqueIdGroups(context.pendingLines),
        lineCount,
        lineNumbers: context.pendingLines.map((line) => line.lineNumber),
      },
      payload: this.logPayloads.captureExchange(requestBody),
    });
  }

  /**
   * Record the bulk response and the per-line error correlation so a failed
   * journal line can be traced back to the line it was built from.
   */
  private async logCashBulkOutcome(args: {
    endpoint: string;
    headerKey: string;
    pendingLines: CashBulkPendingLine[];
    attempt: CashBulkAttempt;
    batch: CashBulkBatch;
    result: TSLedgerJournalTransCustomBulkResponseBody | null | undefined;
    failures: CashBulkLineFailure[];
  }): Promise<void> {
    const {
      endpoint,
      headerKey,
      pendingLines,
      attempt,
      batch,
      result,
      failures,
    } = args;
    const succeeded = failures.length === 0;
    const direction = this.resolveCashBulkDirection(endpoint);
    const label = direction === 'in' ? 'Cash-in' : 'Cash-out';

    await this.operationalLogs.emit({
      level: succeeded ? 'info' : 'error',
      message: succeeded
        ? `${label} bulk request ${batch.number}/${batch.total} for journal ${headerKey} accepted ${pendingLines.length} line(s)`
        : `${label} bulk request ${batch.number}/${batch.total} for journal ${headerKey} failed for ${failures.length} line(s)`,
      context: CustomerPaymentJournalService.name,
      eventType: `d365fo.cash-${direction}.bulk-response`,
      status: succeeded ? 'accepted' : 'rejected',
      metadata: {
        endpoint,
        cashDirection: direction,
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
      },
      payload: this.logPayloads.captureExchange(undefined, result ?? null),
    });
  }

  private resolveCashBulkDirection(endpoint: string): 'in' | 'out' {
    return endpoint.includes('addLedgerJournalTransCustPaym') ? 'in' : 'out';
  }

  /**
   * Project an internal cash line onto a `_contract.Lines` entry.
   *
   * Emits the Cash Out bulk shape that X++ FormJsonSerializer looks up by key
   * (`ExchangeRate`, `ReportingExchangeRate`, `VendorGroup`, offset fields).
   * MarkedLines is included only when the line actually settles invoices.
   * Scenario 4 (main account-only) keeps the offset keys present with empty
   * values so FO lookups do not throw.
   */
  private toD365BulkCashLine(
    line: TSLedgerJournalTransCustomRequestBody,
  ): TSLedgerJournalTransCustomBulkLineRequestBody {
    const exchangeRate = Number(
      line.ExchangeRate ?? line.EXCHANGERATE ?? line.ExchRate ?? 0,
    );
    const reportingExchangeRate = Number(
      line.ReportingExchangeRate ??
        line.REPORTINGEXCHANGERATE ??
        line.ReportingCurrencyExchRate ??
        line.ExchRateSecond ??
        0,
    );
    const markedLines = Array.isArray(line.MarkedLines)
      ? line.MarkedLines.filter(
          (marked) =>
            Boolean(String(marked?.InvoiceNumber ?? '').trim()) ||
            Boolean(String(marked?.DocumentNumber ?? '').trim()) ||
            Boolean(String(marked?.OperationNumber ?? '').trim()),
        )
      : [];
    const stripBidi = (value: string) =>
      value.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');

    const body: TSLedgerJournalTransCustomBulkLineRequestBody = {
      journalNum: String(line.journalNum ?? '').trim(),
      AccountNum: String(line.AccountNum ?? ''),
      accountTypeStr: String(line.accountTypeStr ?? '')
        .trim()
        .toLowerCase() as TSLedgerJournalTransCustomBulkLineRequestBody['accountTypeStr'],
      BANKTRANSACTIONTYPE: String(line.BANKTRANSACTIONTYPE ?? ''),
      CENTRALBANKPURPOSECODE: String(line.CENTRALBANKPURPOSECODE ?? ''),
      CENTRALBANKPURPOSETEXT: String(line.CENTRALBANKPURPOSETEXT ?? ''),
      company: String(line.company ?? ''),
      transDate: this.normalizeFoJsonDate(String(line.transDate ?? '')),
      DocumentNum: String(line.DocumentNum ?? ''),
      DocumentDate: this.normalizeFoJsonDate(String(line.DocumentDate ?? '')),
      creditAmount: Number(line.creditAmount ?? 0),
      currency: String(line.currency ?? ''),
      debitAmount: Number(line.debitAmount ?? 0),
      DEFAULTDIMENSIONDISPLAYVALUE: String(
        line.DEFAULTDIMENSIONDISPLAYVALUE ?? '',
      ),
      offsetDEFAULTDIMENSIONDISPLAYVALUE: String(
        line.offsetDEFAULTDIMENSIONDISPLAYVALUE ?? '',
      ),
      // Always present: X++ does jsonMap.lookup("ExchangeRate") unconditionally.
      ExchangeRate: Number.isFinite(exchangeRate) ? exchangeRate : 0,
      FinTagStr: stripBidi(String(line.FinTagStr ?? '')),
      ISPREPAYMENT: String(line.ISPREPAYMENT ?? 'No'),
      ITEMWITHHOLDINGTAXGROUP: String(line.ITEMWITHHOLDINGTAXGROUP ?? ''),
      offsetAccountDisplayValue: String(line.offsetAccountDisplayValue ?? ''),
      OffsetAccountTypeStr: line.OffsetAccountTypeStr ?? '',
      OffsetCompany: String(line.OffsetCompany ?? ''),
      OFFSETFINTAGDISPLAYVALUE: stripBidi(
        String(line.OFFSETFINTAGDISPLAYVALUE ?? ''),
      ),
      OFFSETTRANSACTIONTEXT: String(line.OFFSETTRANSACTIONTEXT ?? ''),
      PAYMENTID: String(line.PAYMENTID ?? ''),
      PAYMENTMETHODNAME: String(line.PAYMENTMETHODNAME ?? ''),
      PAYMENTNOTES: String(line.PAYMENTNOTES ?? ''),
      PAYMENTREFERENCE: String(line.PAYMENTREFERENCE ?? ''),
      PAYMENTSPECIFICATION: String(line.PAYMENTSPECIFICATION ?? ''),
      PostingProfile: String(line.PostingProfile ?? ''),
      TaxGroup: String(line.TaxGroup ?? ''),
      TAXITEMGROUP: String(line.TAXITEMGROUP ?? ''),
      TRANSACTIONTEXT: String(line.TRANSACTIONTEXT ?? ''),
      ReportingExchangeRate: Number.isFinite(reportingExchangeRate)
        ? reportingExchangeRate
        : 0,
      // Always present: X++ does jsonMap.lookup("VendorGroup") unconditionally.
      VendorGroup: String(line.VendorGroup ?? ''),
    };

    // Cash-In keeps MARKEDINVOICE for existing CustPaym behavior and also
    // carries the structured MarkedLines array. Cash-Out uses MarkedLines as
    // its settlement contract.
    // Preserve MARKEDINVOICE whenever the mapper set it (including null for
    // unmarked).
    if ('MARKEDINVOICE' in line) {
      body.MARKEDINVOICE =
        line.MARKEDINVOICE === null || line.MARKEDINVOICE === undefined
          ? null
          : String(line.MARKEDINVOICE);
    }

    // Always project settlement marks onto the FO body when present. Omitting
    // MarkedLines here is what made Vendor Payment journals post without
    // SpecTrans after format had already built the marks correctly.
    if (markedLines.length > 0) {
      body.MarkedLines = markedLines.map((marked) => ({
        InvoiceNumber: String(marked.InvoiceNumber ?? ''),
        OperationNumber: stripBidi(String(marked.OperationNumber ?? '')),
        DocumentNumber: String(marked.DocumentNumber ?? ''),
        HasWithHoldingLine: Boolean(marked.HasWithHoldingLine),
      }));
    }

    return body;
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

  public async headerExists(
    headerKey: string,
    dataAreaId: string,
  ): Promise<boolean> {
    return (await this.getHeaderIdentity(headerKey, dataAreaId)) !== null;
  }

  public async getHeaderIdentity(
    headerKey: string,
    dataAreaId: string,
  ): Promise<{ JournalBatchNumber: string; Description?: string } | null> {
    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', dataAreaId),
      this.queryBuilder.eq('JournalBatchNumber', headerKey),
    );
    const query = this.queryBuilder.buildQuery(
      '/data/CustomerPaymentJournalHeaders',
      {
        filter,
        select: ['JournalBatchNumber', 'Description'],
        top: 1,
        crossCompany: true,
      },
    );
    const response = await this.d365foClient.get<{
      JournalBatchNumber: string;
      Description?: string;
    }>(query, { useCache: false });
    return (
      (response.value ?? []).find(
        (header) => header.JournalBatchNumber === headerKey,
      ) ?? null
    );
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
