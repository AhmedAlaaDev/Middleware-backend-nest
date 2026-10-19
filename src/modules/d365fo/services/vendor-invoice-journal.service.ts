import { Injectable, Logger } from '@nestjs/common';
import { isAxiosError } from 'axios';

import { D365FOClientService } from './d365fo-client.service';
import { DfoErrorExtractorService } from './dfo-error-extractor.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

import { VendorCandidateTransaction } from '@/modules/cash/processors/outbound/vendor-payment';
import {
  normalizeVendorDocumentNumber,
  normalizeVendorLookupText,
  vendorInvoiceIdentityEquals,
} from '@/modules/cash/processors/outbound/vendor-payment/policies/vendor-invoice-identity.policy';
import {
  createCustodySettlementSkipRow,
  CustodySettlementSkipRow,
  skipErrorMessage,
} from '@/modules/cash/services/custody-settlement-skip-report';
import {
  D365FOVendorInvoiceJournalHeaderRequest,
  D365FOVendorInvoiceJournalHeaderResponse,
  D365FOVendorInvoiceJournalLineRequest,
} from '@/modules/d365fo/types';
import { RetryService } from '@/modules/resilience/services/retry.service';

/** Max invoices per OR filter chunk (FO does not support OData `in`). */
const VENDOR_INVOICE_LOOKUP_CHUNK_SIZE = 20;

export type VendorInvoiceVendorPairKey = string;

export type VendorInvoiceSettlementState =
  | 'OPEN'
  | 'CLOSED'
  | 'UNKNOWN'
  | 'NOT_FOUND'
  | 'WRONG_VENDOR';

export interface VendorInvoiceSettlementSnapshot {
  invoice: string;
  vendorAccount: string;
  company: string;
  exists: boolean;
  belongsToVendor: boolean;
  settlementState: VendorInvoiceSettlementState;
  isOpen: boolean | null;
  currencyCode: string;
  originalAmount: number | null;
  remainingAmount: number | null;
  lastSettleVoucher: string;
  sourceKey: string;
  documentNumber?: string;
  candidateTransactions?: VendorCandidateTransaction[];
}

export type VendorPaymentSettlementVerificationStatus =
  | 'VERIFIED'
  | 'NOT_VERIFIED'
  | 'FAILED';

export interface VendorPaymentSettlementVerification {
  lineNumber: number;
  status: VendorPaymentSettlementVerificationStatus;
  reason: string;
  expectedVendorAccount: string;
  expectedInvoices: string[];
  matchedInvoices: string[];
  settlementAmount: number;
  journalBatchNumber: string;
  journalMarkedInvoice: string;
  settleVoucher: string;
  journalLineExists: boolean;
}

export interface VendorPaymentJournalSettlementTarget {
  lineNumber: number;
  vendorAccount: string;
  currencyCode: string;
  debitAmount: number;
  creditAmount: number;
  invoiceNumber: string;
  documentNumber: string;
  /** Excel UniqueId / PAYMENTID. Used only in error text, not sent to D365. */
  uniqueId?: string;
  /** Excel LINENUMBER from the source workbook. */
  sourceLineNumber?: number;
}

export interface VendorPaymentJournalSettlementPayload {
  JournalLineCompany: string;
  JournalBatchNumber: string;
  JournalLineNumber: number;
  InvoiceNumber: string;
  InvoiceCompany: string;
  InvoiceDueDate: string;
  SettlementAmountInInvoiceCurrency: number;
  CashDiscountToTakeInInvoiceCurrency: number;
}

interface AggregatedVendorPaymentJournalSettlementTarget extends VendorPaymentJournalSettlementTarget {
  lineNumbers: number[];
  settlementAmount: number;
  uniqueIds: string[];
  sourceLineNumbers: number[];
}

type VendTransLookupRow = {
  SourceKey?: string | number;
  RecId?: string | number;
  TransactionId?: string | number;
  VendTransRecId?: string | number;
  Invoice?: string;
  AccountNum?: string;
  CurrencyCode?: string;
  Closed?: string | number | boolean;
  AmountCur?: string | number;
  AmountMST?: string | number;
  AmountReportingCurrency?: string | number;
  ReportingCurrencyAmount?: string | number;
  RemainAmountCur?: string | number;
  RemainAmountMST?: string | number;
  RemainAmountReportingCurrency?: string | number;
  SettleAmountCur?: string | number;
  SettleAmountMST?: string | number;
  SettleAmountReporting?: string | number;
  LastSettleVoucher?: string;
  DocumentNum?: string;
  Document?: string;
  Voucher?: string;
  TransDate?: string;
  DocumentDate?: string;
  DueDate?: string;
};

type VendorPaymentSettledInvoiceRow = {
  JournalLineCompany?: string;
  JournalBatchNumber?: string;
  JournalLineNumber?: string | number;
  InvoiceNumber?: string;
  InvoiceCompany?: string;
  InvoiceDueDate?: string;
  SettlementAmountInInvoiceCurrency?: string | number;
  CashDiscountToTakeInInvoiceCurrency?: string | number;
  invoiceAccount?: string;
  AccountDisplayValue?: string;
};

type VendorPaymentJournalLineLookupRow = {
  LineNumber?: string | number;
  MarkedInvoice?: string;
  SettleVoucher?: string;
  AccountDisplayValue?: string;
  CurrencyCode?: string;
  DebitAmount?: string | number;
  CreditAmount?: string | number;
  PaymentId?: string;
  TransactionText?: string;
};

/**
 * Service for managing vendor invoice journals in D365FO
 */
@Injectable()
export class VendorInvoiceJournalService {
  private readonly logger = new Logger(VendorInvoiceJournalService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
    private readonly retryService: RetryService,
    private readonly dfoErrorExtractor: DfoErrorExtractorService,
  ) {}

  /**
   * Build map key for invoice + vendor account pair (case-insensitive).
   */
  public static pairKey(invoice: string, vendorAccount: string): string {
    return `${invoice.trim().toLowerCase()}|${vendorAccount.trim().toLowerCase()}`;
  }

  /**
   * Build the settlement lookup key in business-match order. Document is part
   * of the identity so equal invoice numbers under the same vendor cannot
   * overwrite one another.
   */
  public static settlementKey(
    invoice: string,
    vendorAccount: string,
    documentNumber?: string,
  ): string {
    const pair = VendorInvoiceJournalService.pairKey(invoice, vendorAccount);
    const document = String(documentNumber ?? '')
      .trim()
      .toLowerCase();
    return document ? `${pair}|${document}` : pair;
  }

  public static findSettlementSnapshot(
    snapshots: Map<string, VendorInvoiceSettlementSnapshot>,
    invoice: string,
    vendorAccount: string,
    documentNumber?: string,
  ): VendorInvoiceSettlementSnapshot | undefined {
    const exactKey = VendorInvoiceJournalService.settlementKey(
      invoice,
      vendorAccount,
      documentNumber,
    );
    const exact = snapshots.get(exactKey);
    if (exact || !String(documentNumber ?? '').trim()) return exact;

    // Compatibility for callers/tests that provide a legacy pair-keyed map.
    // Maps produced by findInvoiceSettlementSnapshots are document-keyed and
    // therefore never use this fallback for document-bearing requests.
    return snapshots.get(
      VendorInvoiceJournalService.pairKey(invoice, vendorAccount),
    );
  }

  public async findInvoiceSettlementSnapshots(
    company: string,
    requests: Array<{
      invoice: string;
      vendorAccount: string;
      documentNumber?: string;
    }>,
  ): Promise<Map<VendorInvoiceVendorPairKey, VendorInvoiceSettlementSnapshot>> {
    const normalizedRequests = [
      ...new Map(
        requests
          .map(({ invoice, vendorAccount, documentNumber }) => ({
            invoice: invoice?.trim(),
            vendorAccount: vendorAccount?.trim(),
            documentNumber: documentNumber?.trim(),
          }))
          .filter(
            (
              request,
            ): request is {
              invoice: string;
              vendorAccount: string;
              documentNumber: string | undefined;
            } => Boolean(request.invoice) && Boolean(request.vendorAccount),
          )
          .map((request) => [
            VendorInvoiceJournalService.settlementKey(
              request.invoice,
              request.vendorAccount,
              request.documentNumber,
            ),
            request,
          ]),
      ).values(),
    ];

    const snapshots = new Map<
      VendorInvoiceVendorPairKey,
      VendorInvoiceSettlementSnapshot
    >();
    if (normalizedRequests.length === 0) return snapshots;

    // Candidate retrieval follows the same hierarchy as verification:
    // vendor first, then document, invoice, and amount. Fetching by invoice
    // first can select another vendor's transaction and reject a valid source
    // row before the deterministic matcher sees the vendor's own candidates.
    const vendorAccounts = [
      ...new Set(
        normalizedRequests
          .map((request) => request.vendorAccount)
          .filter(Boolean),
      ),
    ];
    const rowsByVendor = normalizedRequests.every((request) =>
      Boolean(request.documentNumber),
    )
      ? await this.fetchVendTransRowsByVendorAndDocument(
          company,
          normalizedRequests.map((request) => ({
            vendorAccount: request.vendorAccount,
            documentNumber: request.documentNumber!,
          })),
        )
      : await this.fetchVendTransRowsByVendor(company, vendorAccounts);

    const invoiceFallbackTargets = normalizedRequests.filter((request) => {
      const requestedDocument = normalizeVendorDocumentNumber(
        request.documentNumber,
      );
      if (!requestedDocument) return false;
      const vendorRows =
        rowsByVendor.get(this.normalizeVendorAccount(request.vendorAccount)) ??
        [];
      return !vendorRows.some(
        (row) =>
          normalizeVendorDocumentNumber(row.DocumentNum || row.Document) ===
          requestedDocument,
      );
    });
    if (invoiceFallbackTargets.length > 0) {
      const invoiceRows = await this.fetchVendTransRowsByVendorAndInvoice(
        company,
        invoiceFallbackTargets.map((request) => ({
          vendorAccount: request.vendorAccount,
          invoice: request.invoice,
        })),
      );
      for (const [vendorAccount, rows] of invoiceRows) {
        const bucket = rowsByVendor.get(vendorAccount) ?? [];
        const seen = new Set(
          bucket.map((row) => String(row.SourceKey ?? row.Voucher ?? '')),
        );
        for (const row of rows) {
          const key = String(row.SourceKey ?? row.Voucher ?? '');
          if (key && seen.has(key)) continue;
          bucket.push(row);
          if (key) seen.add(key);
        }
        rowsByVendor.set(vendorAccount, bucket);
      }
    }

    for (const request of normalizedRequests) {
      const vendorRows =
        rowsByVendor.get(this.normalizeVendorAccount(request.vendorAccount)) ??
        [];
      const requestedDocument = normalizeVendorDocumentNumber(
        request.documentNumber,
      );
      const documentRows = requestedDocument
        ? vendorRows.filter(
            (row) =>
              normalizeVendorDocumentNumber(row.DocumentNum || row.Document) ===
              requestedDocument,
          )
        : vendorRows;
      const invoiceRows = documentRows.filter((row) =>
        vendorInvoiceIdentityEquals(row.Invoice, request.invoice),
      );
      const row = invoiceRows[0] ?? documentRows[0];

      // A snapshot now means that this vendor has candidate transactions.
      // The verification service is responsible for narrowing those rows by
      // document, then invoice, then amount.
      const exists = documentRows.length > 0;
      const belongsToVendor = vendorRows.length > 0;

      const candidateTransactions: VendorCandidateTransaction[] =
        documentRows.map((r) => {
          const orig = this.firstDefinedNumber(
            r.AmountCur,
            r.AmountMST,
            r.AmountReportingCurrency,
            r.ReportingCurrencyAmount,
          );
          const rem = this.resolveRemainingAmount(r, orig);
          const isClosed = this.readClosedState(r.Closed);
          return {
            vendorAccount: String(r.AccountNum ?? '').trim(),
            documentNumber: String(r.DocumentNum || r.Document || '').trim(),
            invoiceNumber: String(r.Invoice ?? '').trim(),
            currencyCode: String(r.CurrencyCode ?? '').trim(),
            originalAmount: Math.abs(orig ?? 0),
            openAmount: Math.abs(rem ?? orig ?? 0),
            voucher: String(r.Voucher ?? '').trim(),
            sourceKey: String(r.SourceKey ?? '').trim(),
            recId: String(
              r.RecId ?? r.TransactionId ?? r.VendTransRecId ?? '',
            ).trim(),
            transactionId: String(r.TransactionId ?? '').trim(),
            isOpen: isClosed !== null ? !isClosed : (rem ?? 0) > 0,
            transDate: String(r.TransDate ?? '').trim(),
            lastSettleVoucher: String(r.LastSettleVoucher ?? '').trim(),
          };
        });

      snapshots.set(
        VendorInvoiceJournalService.settlementKey(
          request.invoice,
          request.vendorAccount,
          request.documentNumber,
        ),
        this.toInvoiceSettlementSnapshot(
          company,
          request.invoice,
          request.vendorAccount,
          row,
          exists,
          belongsToVendor,
          candidateTransactions,
        ),
      );
    }

    return snapshots;
  }

  public async verifyVendorPaymentJournalSettlements(options: {
    company: string;
    journalBatchNumber: string;
    lines: Array<{
      lineNumber: number;
      vendorAccount: string;
      expectedInvoices: string[];
    }>;
  }): Promise<VendorPaymentSettlementVerification[]> {
    const { company, journalBatchNumber, lines } = options;
    const targets = lines.filter(
      (line) =>
        line.lineNumber > 0 &&
        Boolean(line.vendorAccount?.trim()) &&
        line.expectedInvoices.some((invoice) => Boolean(invoice?.trim())),
    );
    if (targets.length === 0) return [];

    const settledByLine = await this.fetchSettledInvoicesByJournalLine(
      company,
      journalBatchNumber,
      targets.map((line) => line.lineNumber),
    );
    const journalLinesByNumber =
      await this.fetchVendorPaymentJournalLinesByNumber(
        company,
        journalBatchNumber,
        targets.map((line) => line.lineNumber),
      );

    return targets.map((line) => {
      const expectedInvoices = line.expectedInvoices
        .map((invoice) => invoice.trim())
        .filter(Boolean);
      const expectedInvoiceKeys = new Set(
        expectedInvoices.map((invoice) => this.normalizeInvoiceValue(invoice)),
      );
      const settledRows = settledByLine.get(line.lineNumber) ?? [];
      const matchedRows = settledRows.filter((row) => {
        const invoiceMatches = expectedInvoiceKeys.has(
          this.normalizeInvoiceValue(row.InvoiceNumber),
        );
        const vendorMatches =
          this.normalizeVendorAccount(row.invoiceAccount) ===
            line.vendorAccount.trim().toLowerCase() ||
          this.normalizeVendorAccount(row.AccountDisplayValue) ===
            line.vendorAccount.trim().toLowerCase();
        return invoiceMatches && vendorMatches;
      });
      const journalLine = journalLinesByNumber.get(line.lineNumber);
      const journalMarkedInvoice = String(
        journalLine?.MarkedInvoice ?? '',
      ).trim();
      const journalLineMatches =
        this.normalizeVendorAccount(journalLine?.AccountDisplayValue) ===
          line.vendorAccount.trim().toLowerCase() &&
        expectedInvoiceKeys.has(
          this.normalizeInvoiceValue(journalMarkedInvoice),
        );
      const settlementAmount = matchedRows.reduce(
        (sum, row) =>
          sum + this.readNumber(row.SettlementAmountInInvoiceCurrency),
        0,
      );
      const verified = matchedRows.length > 0 || journalLineMatches;

      return {
        lineNumber: line.lineNumber,
        status: verified ? 'VERIFIED' : 'NOT_VERIFIED',
        reason:
          matchedRows.length > 0
            ? `Verified ${matchedRows.length} settled invoice row(s)`
            : journalLineMatches
              ? `Marked invoice ${journalMarkedInvoice} persisted on vendor payment journal line ${line.lineNumber}`
              : `No settled invoice rows matched vendor ${line.vendorAccount} and invoices ${expectedInvoices.join(', ')}`,
        expectedVendorAccount: line.vendorAccount,
        expectedInvoices,
        matchedInvoices: matchedRows
          .map((row) => String(row.InvoiceNumber ?? '').trim())
          .filter(Boolean),
        settlementAmount,
        journalBatchNumber,
        journalMarkedInvoice,
        settleVoucher: String(journalLine?.SettleVoucher ?? '').trim(),
        journalLineExists: Boolean(journalLine),
      };
    });
  }

  /**
   * Create invoice settlement rows after Cash-Out Custody Settlement lines
   * have been created by addLedgerJournalTransVendPaym.
   *
   * This is deliberately an explicit second step. The caller uses it only for
   * non-Custody vendor groups whose MarkedLines must not reach the X++ request.
   */
  public async createVendorPaymentJournalLineSettlements(options: {
    company: string;
    journalBatchNumber: string;
    targets: VendorPaymentJournalSettlementTarget[];
    continueOnError?: boolean;
    skipped?: CustodySettlementSkipRow[];
  }): Promise<VendorPaymentSettlementVerification[]> {
    const company = String(options.company ?? '').trim();
    const journalBatchNumber = String(options.journalBatchNumber ?? '').trim();
    const continueOnError = Boolean(options.continueOnError);
    const skipped = options.skipped;
    const targets = this.aggregateVendorPaymentSettlementTargets(
      options.targets.filter(
        (target) =>
          target.lineNumber > 0 &&
          Boolean(target.vendorAccount?.trim()) &&
          Boolean(target.invoiceNumber?.trim()),
      ),
    );
    if (targets.length === 0) return [];

    const existingByLine = await this.fetchSettledInvoicesByJournalLine(
      company,
      journalBatchNumber,
      targets.flatMap((target) => target.lineNumbers),
    );
    const verificationLines: Array<{
      lineNumber: number;
      vendorAccount: string;
      expectedInvoices: string[];
      expectedSettlementAmount: number;
    }> = [];

    for (const target of targets) {
      try {
        await this.settleOneVendorPaymentJournalTarget({
          company,
          journalBatchNumber,
          target,
          existingByLine,
          verificationLines,
        });
      } catch (error) {
        this.recordSettlementSkip({
          continueOnError,
          skipped,
          journalBatchNumber,
          target,
          error,
        });
      }
    }

    if (verificationLines.length === 0) return [];

    const verification = await this.verifyVendorPaymentJournalSettlements({
      company,
      journalBatchNumber,
      lines: verificationLines,
    });
    const failures = verification.filter((result) => {
      const expected = verificationLines.find(
        (line) => line.lineNumber === result.lineNumber,
      );
      return (
        result.status !== 'VERIFIED' ||
        !expected ||
        Math.abs(result.settlementAmount - expected.expectedSettlementAmount) >
          0.01
      );
    });
    if (failures.length > 0) {
      const message = `Cash-out settlement rows were not verified: ${failures
        .map((failure) => `line ${failure.lineNumber}: ${failure.reason}`)
        .join('; ')}`;
      if (!continueOnError) {
        throw new Error(message);
      }
      for (const failure of failures) {
        const target = targets.find(
          (candidate) =>
            candidate.lineNumber === failure.lineNumber ||
            candidate.lineNumbers.includes(failure.lineNumber),
        );
        this.recordSettlementSkip({
          continueOnError: true,
          skipped,
          journalBatchNumber,
          target: target ?? {
            lineNumber: failure.lineNumber,
            lineNumbers: [failure.lineNumber],
            vendorAccount: failure.expectedVendorAccount ?? '',
            currencyCode: '',
            debitAmount: 0,
            creditAmount: 0,
            invoiceNumber: failure.expectedInvoices?.[0] ?? '',
            documentNumber: '',
            settlementAmount: failure.settlementAmount,
            uniqueIds: [],
            sourceLineNumbers: [],
          },
          error: `${failure.reason}: ${message}`,
        });
      }
      return verification.filter((result) => result.status === 'VERIFIED');
    }
    return verification;
  }

  private async settleOneVendorPaymentJournalTarget(options: {
    company: string;
    journalBatchNumber: string;
    target: AggregatedVendorPaymentJournalSettlementTarget;
    existingByLine: Map<number, VendorPaymentSettledInvoiceRow[]>;
    verificationLines: Array<{
      lineNumber: number;
      vendorAccount: string;
      expectedInvoices: string[];
      expectedSettlementAmount: number;
    }>;
  }): Promise<void> {
    const { company, journalBatchNumber, target, existingByLine } = options;
    const existing = this.findMatchingSettlementRow(
      target.lineNumbers.flatMap(
        (lineNumber) => existingByLine.get(lineNumber) ?? [],
      ),
      target,
    );
    const settlementAmount = target.settlementAmount;
    const settlementLineNumber = existing
      ? this.readNumber(existing.JournalLineNumber)
      : target.lineNumber;
    if (existing) {
      if (
        Math.abs(
          this.readNumber(existing.SettlementAmountInInvoiceCurrency) -
            settlementAmount,
        ) > 0.01
      ) {
        await this.updateVendorPaymentJournalLineSettlement(
          company,
          journalBatchNumber,
          settlementLineNumber,
          existing,
          settlementAmount,
        );
      }
      options.verificationLines.push({
        lineNumber: settlementLineNumber,
        vendorAccount: target.vendorAccount,
        expectedInvoices: [target.invoiceNumber],
        expectedSettlementAmount: settlementAmount,
      });
      return;
    }

    const invoice = await this.findOpenInvoiceForJournalSettlement(
      company,
      target,
    );
    const remainingAmount = this.resolveRemainingAmount(
      invoice,
      this.firstDefinedNumber(
        invoice.AmountCur,
        invoice.AmountMST,
        invoice.AmountReportingCurrency,
        invoice.ReportingCurrencyAmount,
      ),
    );
    if (
      remainingAmount !== null &&
      Math.abs(settlementAmount) - remainingAmount > 0.01
    ) {
      throw new Error(
        `Settlement amount ${Math.abs(settlementAmount)} for ${this.describeSettlementTarget(target)} exceeds invoice ${target.invoiceNumber} remainder ${remainingAmount}.`,
      );
    }

    const invoiceDueDate = String(invoice.DueDate ?? '').trim();
    if (!invoiceDueDate) {
      throw new Error(
        `Open invoice ${target.invoiceNumber} for vendor ${target.vendorAccount} has no due date (${this.describeSettlementTarget(target)}).`,
      );
    }

    const payload: VendorPaymentJournalSettlementPayload = {
      JournalLineCompany: company,
      JournalBatchNumber: journalBatchNumber,
      JournalLineNumber: settlementLineNumber,
      InvoiceNumber: target.invoiceNumber.trim(),
      InvoiceCompany: company,
      InvoiceDueDate: invoiceDueDate,
      SettlementAmountInInvoiceCurrency: settlementAmount,
      CashDiscountToTakeInInvoiceCurrency: 0,
    };

    try {
      await this.d365foClient.post<
        VendorPaymentJournalSettlementPayload,
        VendorPaymentSettledInvoiceRow
      >('/data/VendorPaymentJournalLineSettledInvoices', payload, {
        retries: 0,
      });
    } catch (error) {
      const recovered = await this.fetchSettledInvoicesByJournalLine(
        company,
        journalBatchNumber,
        [settlementLineNumber],
      );
      if (
        !this.findMatchingSettlementRow(
          recovered.get(settlementLineNumber) ?? [],
          target,
        )
      ) {
        throw error;
      }
    }
    options.verificationLines.push({
      lineNumber: settlementLineNumber,
      vendorAccount: target.vendorAccount,
      expectedInvoices: [target.invoiceNumber],
      expectedSettlementAmount: settlementAmount,
    });
  }

  private recordSettlementSkip(options: {
    continueOnError: boolean;
    skipped?: CustodySettlementSkipRow[];
    journalBatchNumber: string;
    target: AggregatedVendorPaymentJournalSettlementTarget;
    error: unknown;
  }): void {
    const row = createCustodySettlementSkipRow({
      uniqueId: [
        ...new Set(
          [
            ...(options.target.uniqueIds ?? []),
            String(options.target.uniqueId ?? '').trim(),
          ].filter((uniqueId) => uniqueId.length > 0),
        ),
      ].join(', '),
      excelLineNumbers: [
        ...(options.target.sourceLineNumbers ?? []),
        options.target.sourceLineNumber,
      ],
      journalBatchNumber: options.journalBatchNumber,
      d365LineNumbers: [
        ...(options.target.lineNumbers ?? []),
        options.target.lineNumber,
      ],
      vendorAccount: options.target.vendorAccount,
      invoiceNumber: options.target.invoiceNumber,
      documentNumber: options.target.documentNumber,
      amount: Math.abs(Number(options.target.settlementAmount ?? 0)),
      phase: 'settle',
      error: options.error,
    });
    options.skipped?.push(row);
    if (!options.continueOnError) {
      throw options.error instanceof Error
        ? options.error
        : new Error(skipErrorMessage(options.error));
    }
  }

  /**
   * Batch-lookup existing invoice/vendor pairs on VendInvoiceJournalLines.
   * D365FO OData does not support `in`; uses
   * `(Invoice eq 'a' or Invoice eq 'b' or …)` chunks, then matches
   * AccountDisplayValue in memory. Returns a Set of pair keys that exist.
   */
  public async findExistingInvoiceVendorPairs(
    company: string,
    invoices: string[],
    options?: { chunkSize?: number; concurrency?: number },
  ): Promise<Set<VendorInvoiceVendorPairKey>> {
    const uniqueInvoices = [
      ...new Set(
        invoices
          .map((invoice) => invoice?.trim())
          .filter((invoice): invoice is string => Boolean(invoice)),
      ),
    ];

    const existingPairs = new Set<VendorInvoiceVendorPairKey>();

    if (uniqueInvoices.length === 0) {
      return existingPairs;
    }

    const chunkSize = Math.min(
      40,
      Math.max(1, options?.chunkSize ?? VENDOR_INVOICE_LOOKUP_CHUNK_SIZE),
    );
    const concurrency = Math.min(5, Math.max(1, options?.concurrency ?? 3));
    const chunks = this.chunkArray(uniqueInvoices, chunkSize);
    const totalChunks = chunks.length;

    this.logger.debug(
      `[LOOKUP] Resolving ${uniqueInvoices.length} vendor invoices against VendInvoiceJournalLines for company '${company}' in ${totalChunks} chunk(s) (chunkSize=${chunkSize}, concurrency=${concurrency})`,
    );

    const startMs = Date.now();

    for (let i = 0; i < chunks.length; i += concurrency) {
      const wave = chunks.slice(i, i + concurrency);
      const waveResults = await Promise.all(
        wave.map((chunk, j) =>
          this.fetchInvoiceVendorPairsChunk(
            company,
            chunk,
            i + j + 1,
            totalChunks,
          ),
        ),
      );

      for (const pairs of waveResults) {
        for (const key of pairs) {
          existingPairs.add(key);
        }
      }
    }

    this.logger.log(
      `[LOOKUP] Found ${existingPairs.size} invoice/vendor pair(s) for ${uniqueInvoices.length} invoice(s) in ${Date.now() - startMs}ms`,
    );

    return existingPairs;
  }

  private async fetchInvoiceVendorPairsChunk(
    company: string,
    invoices: string[],
    chunkIndex: number,
    totalChunks: number,
  ): Promise<Set<VendorInvoiceVendorPairKey>> {
    const pairs = new Set<VendorInvoiceVendorPairKey>();

    const invoiceOrFilter = `(${this.queryBuilder.or(
      ...invoices.map((invoice) => this.queryBuilder.eq('Invoice', invoice)),
    )})`;

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', company),
      invoiceOrFilter,
    );

    let endpoint = this.queryBuilder.buildQuery(
      '/data/VendInvoiceJournalLines',
      {
        filter,
        select: ['Invoice', 'AccountDisplayValue'],
        crossCompany: true,
      },
    );

    type RawLine = {
      Invoice?: string;
      AccountDisplayValue?: string;
    };

    let pages = 0;

    try {
      while (true) {
        pages += 1;
        const response = await this.d365foClient.get<RawLine>(endpoint, {
          useCache: false,
        });

        for (const row of response.value ?? []) {
          const invoice = row.Invoice?.trim();
          const vendorAccount = row.AccountDisplayValue?.trim();
          if (!invoice || !vendorAccount) continue;
          pairs.add(
            VendorInvoiceJournalService.pairKey(invoice, vendorAccount),
          );
        }

        const nextLink = response['@odata.nextLink'];
        if (!nextLink) break;
        endpoint = this.getEndpointFromNextLink(nextLink);
      }

      this.logger.debug(
        `[LOOKUP] Chunk ${chunkIndex}/${totalChunks}: ${invoices.length} invoice(s) → ${pairs.size} pair(s) in ${pages} page(s)`,
      );

      return pairs;
    } catch (error) {
      const errorDetails = this.dfoErrorExtractor.extractMessage(error);
      this.logger.error(
        `[LOOKUP] Chunk ${chunkIndex}/${totalChunks} failed: ${errorDetails}`,
      );
      throw new Error(
        `Vendor invoice lookup failed (chunk ${chunkIndex}/${totalChunks}): ${errorDetails}`,
      );
    }
  }

  private async fetchVendTransRowsByInvoice(
    company: string,
    invoices: string[],
  ): Promise<Map<string, VendTransLookupRow[]>> {
    const uniqueInvoices = [
      ...new Set(
        invoices
          .flatMap((invoice) => (invoice ? [invoice, invoice.trim()] : []))
          .filter(Boolean),
      ),
    ] as string[];
    const rowsByInvoice = new Map<string, VendTransLookupRow[]>();
    if (uniqueInvoices.length === 0) return rowsByInvoice;

    const chunkSize = VENDOR_INVOICE_LOOKUP_CHUNK_SIZE;
    const concurrency = 4;
    const chunks = this.chunkArray(uniqueInvoices, chunkSize);

    for (let i = 0; i < chunks.length; i += concurrency) {
      const wave = chunks.slice(i, i + concurrency);
      await Promise.all(
        wave.map(async (chunk) => {
          const invoiceOrFilter = `(${this.queryBuilder.or(
            ...chunk.map((invoice) => this.queryBuilder.eq('Invoice', invoice)),
          )})`;
          let endpoint = this.queryBuilder.buildQuery(
            '/data/VendTransBiEntities',
            {
              filter: this.queryBuilder.and(
                this.queryBuilder.eq('dataAreaId', company),
                invoiceOrFilter,
              ),
              crossCompany: true,
            },
          );

          while (true) {
            const response = await this.d365foClient.get<VendTransLookupRow>(
              endpoint,
              { useCache: false },
            );

            for (const row of response.value ?? []) {
              const invoice = this.normalizeInvoiceValue(row.Invoice);
              if (!invoice) continue;
              const bucket = rowsByInvoice.get(invoice) ?? [];
              bucket.push(row);
              rowsByInvoice.set(invoice, bucket);
            }

            const nextLink = response['@odata.nextLink'];
            if (!nextLink) break;
            endpoint = this.getEndpointFromNextLink(nextLink);
          }
        }),
      );
    }

    return rowsByInvoice;
  }

  private async fetchVendTransRowsByVendor(
    company: string,
    vendorAccounts: string[],
  ): Promise<Map<string, VendTransLookupRow[]>> {
    const uniqueVendors = [
      ...new Set(
        vendorAccounts
          .map((vendorAccount) => vendorAccount?.trim())
          .filter(Boolean),
      ),
    ] as string[];
    const rowsByVendor = new Map<string, VendTransLookupRow[]>();
    if (uniqueVendors.length === 0) return rowsByVendor;

    const chunkSize = VENDOR_INVOICE_LOOKUP_CHUNK_SIZE;
    const concurrency = 4;
    const chunks = this.chunkArray(uniqueVendors, chunkSize);

    for (let i = 0; i < chunks.length; i += concurrency) {
      const wave = chunks.slice(i, i + concurrency);
      await Promise.all(
        wave.map(async (chunk) => {
          const vendorOrFilter = `(${this.queryBuilder.or(
            ...chunk.map((vendorAccount) =>
              this.queryBuilder.eq(
                'AccountNum',
                normalizeVendorLookupText(vendorAccount),
              ),
            ),
          )})`;
          let endpoint = this.queryBuilder.buildQuery(
            '/data/VendTransBiEntities',
            {
              filter: this.queryBuilder.and(
                this.queryBuilder.eq('dataAreaId', company),
                vendorOrFilter,
              ),
              crossCompany: true,
            },
          );

          while (true) {
            const response = await this.d365foClient.get<VendTransLookupRow>(
              endpoint,
              { useCache: false },
            );

            for (const row of response.value ?? []) {
              const vendorAccount = this.normalizeVendorAccount(row.AccountNum);
              if (!vendorAccount) continue;
              const bucket = rowsByVendor.get(vendorAccount) ?? [];
              bucket.push(row);
              rowsByVendor.set(vendorAccount, bucket);
            }

            const nextLink = response['@odata.nextLink'];
            if (!nextLink) break;
            endpoint = this.getEndpointFromNextLink(nextLink);
          }
        }),
      );
    }

    return rowsByVendor;
  }

  /**
   * Validation normally has both vendor and document. Querying those exact
   * pairs avoids loading each vendor's complete VendTrans history into memory.
   */
  private async fetchVendTransRowsByVendorAndDocument(
    company: string,
    targets: Array<{ vendorAccount: string; documentNumber: string }>,
  ): Promise<Map<string, VendTransLookupRow[]>> {
    const uniqueTargets = [
      ...new Map(
        targets
          .map((target) => ({
            vendorAccount: target.vendorAccount?.trim(),
            documentNumber: target.documentNumber?.trim(),
          }))
          .filter(
            (
              target,
            ): target is {
              vendorAccount: string;
              documentNumber: string;
            } =>
              Boolean(target.vendorAccount) && Boolean(target.documentNumber),
          )
          .map((target) => [
            `${this.normalizeVendorAccount(target.vendorAccount)}|${target.documentNumber.toLowerCase()}`,
            target,
          ]),
      ).values(),
    ];
    const rowsByVendor = new Map<string, VendTransLookupRow[]>();
    if (uniqueTargets.length === 0) return rowsByVendor;

    const chunks = this.chunkArray(
      uniqueTargets,
      VENDOR_INVOICE_LOOKUP_CHUNK_SIZE,
    );
    const concurrency = 4;
    for (let i = 0; i < chunks.length; i += concurrency) {
      const wave = chunks.slice(i, i + concurrency);
      await Promise.all(
        wave.map(async (chunk) => {
          const targetFilter = `(${this.queryBuilder.or(
            ...chunk.flatMap((target) => {
              const vendorAccount = normalizeVendorLookupText(
                target.vendorAccount,
              );
              const documents = this.documentLookupValues(target.documentNumber);
              return documents.map(
                (documentNumber) =>
                  `(${this.queryBuilder.and(
                    this.queryBuilder.eq('AccountNum', vendorAccount),
                    this.queryBuilder.eq('DocumentNum', documentNumber),
                  )})`,
              );
            }),
          )})`;
          let endpoint = this.queryBuilder.buildQuery(
            '/data/VendTransBiEntities',
            {
              select: [
                'SourceKey',
                'Invoice',
                'AccountNum',
                'CurrencyCode',
                'Closed',
                'AmountCur',
                'SettleAmountCur',
                'DocumentNum',
                'Voucher',
                'TransDate',
              ],
              filter: this.queryBuilder.and(
                this.queryBuilder.eq('dataAreaId', company),
                targetFilter,
              ),
              crossCompany: true,
            },
          );

          while (true) {
            const response = await this.d365foClient.get<VendTransLookupRow>(
              endpoint,
              { useCache: false },
            );
            for (const row of response.value ?? []) {
              const vendorAccount = this.normalizeVendorAccount(row.AccountNum);
              if (!vendorAccount) continue;
              const bucket = rowsByVendor.get(vendorAccount) ?? [];
              bucket.push(row);
              rowsByVendor.set(vendorAccount, bucket);
            }
            const nextLink = response['@odata.nextLink'];
            if (!nextLink) break;
            endpoint = this.getEndpointFromNextLink(nextLink);
          }
        }),
      );
    }

    return rowsByVendor;
  }

  /**
   * Document-scoped lookup misses a real transaction when Excel stored the
   * document with different padding. The invoice is still an exact Finance
   * identity, so load those rows and let document normalization decide.
   */
  private async fetchVendTransRowsByVendorAndInvoice(
    company: string,
    targets: Array<{ vendorAccount: string; invoice: string }>,
  ): Promise<Map<string, VendTransLookupRow[]>> {
    const uniqueTargets = [
      ...new Map(
        targets
          .map((target) => ({
            vendorAccount: normalizeVendorLookupText(target.vendorAccount),
            invoice: normalizeVendorLookupText(target.invoice),
          }))
          .filter(
            (
              target,
            ): target is { vendorAccount: string; invoice: string } =>
              Boolean(target.vendorAccount) && Boolean(target.invoice),
          )
          .map((target) => [
            `${this.normalizeVendorAccount(target.vendorAccount)}|${target.invoice.toLowerCase()}`,
            target,
          ]),
      ).values(),
    ];
    const rowsByVendor = new Map<string, VendTransLookupRow[]>();
    if (uniqueTargets.length === 0) return rowsByVendor;

    const chunks = this.chunkArray(
      uniqueTargets,
      VENDOR_INVOICE_LOOKUP_CHUNK_SIZE,
    );
    const concurrency = 4;
    for (let i = 0; i < chunks.length; i += concurrency) {
      const wave = chunks.slice(i, i + concurrency);
      await Promise.all(
        wave.map(async (chunk) => {
          const targetFilter = `(${this.queryBuilder.or(
            ...chunk.map(
              (target) =>
                `(${this.queryBuilder.and(
                  this.queryBuilder.eq('AccountNum', target.vendorAccount),
                  this.queryBuilder.eq('Invoice', target.invoice),
                )})`,
            ),
          )})`;
          let endpoint = this.queryBuilder.buildQuery(
            '/data/VendTransBiEntities',
            {
              select: [
                'SourceKey',
                'Invoice',
                'AccountNum',
                'CurrencyCode',
                'Closed',
                'AmountCur',
                'SettleAmountCur',
                'DocumentNum',
                'Voucher',
                'TransDate',
              ],
              filter: this.queryBuilder.and(
                this.queryBuilder.eq('dataAreaId', company),
                targetFilter,
              ),
              crossCompany: true,
            },
          );

          while (true) {
            const response = await this.d365foClient.get<VendTransLookupRow>(
              endpoint,
              { useCache: false },
            );
            for (const row of response.value ?? []) {
              const vendorAccount = this.normalizeVendorAccount(row.AccountNum);
              if (!vendorAccount) continue;
              const bucket = rowsByVendor.get(vendorAccount) ?? [];
              bucket.push(row);
              rowsByVendor.set(vendorAccount, bucket);
            }
            const nextLink = response['@odata.nextLink'];
            if (!nextLink) break;
            endpoint = this.getEndpointFromNextLink(nextLink);
          }
        }),
      );
    }

    return rowsByVendor;
  }

  private documentLookupValues(documentNumber: string): string[] {
    const cleaned = normalizeVendorLookupText(documentNumber).replace(
      /\.0+$/,
      '',
    );
    const normalized = normalizeVendorDocumentNumber(documentNumber);
    return [...new Set([cleaned, normalized].filter(Boolean))];
  }

  private toInvoiceSettlementSnapshot(
    company: string,
    invoice: string,
    vendorAccount: string,
    row: VendTransLookupRow | undefined,
    exists: boolean,
    belongsToVendor: boolean,
    candidates: VendorCandidateTransaction[] = [],
  ): VendorInvoiceSettlementSnapshot {
    if (!row || !exists) {
      return {
        invoice,
        vendorAccount,
        company,
        exists: false,
        belongsToVendor: false,
        settlementState: 'NOT_FOUND',
        isOpen: null,
        currencyCode: '',
        originalAmount: null,
        remainingAmount: null,
        lastSettleVoucher: '',
        sourceKey: '',
        documentNumber: '',
        candidateTransactions: [],
      };
    }

    const originalAmount = this.firstDefinedNumber(
      row.AmountCur,
      row.AmountMST,
      row.AmountReportingCurrency,
      row.ReportingCurrencyAmount,
    );
    const remainingAmount = this.resolveRemainingAmount(row, originalAmount);
    const closedFlag = this.readClosedState(row.Closed);
    const isOpen =
      closedFlag !== null
        ? !closedFlag
        : remainingAmount !== null
          ? remainingAmount > 0
          : null;

    return {
      invoice,
      vendorAccount,
      company,
      exists,
      belongsToVendor,
      settlementState: !belongsToVendor
        ? 'WRONG_VENDOR'
        : isOpen === true
          ? 'OPEN'
          : isOpen === false
            ? 'CLOSED'
            : 'UNKNOWN',
      isOpen,
      currencyCode: String(row.CurrencyCode ?? '').trim(),
      originalAmount,
      remainingAmount,
      lastSettleVoucher: String(row.LastSettleVoucher ?? '').trim(),
      sourceKey: String(row.SourceKey ?? '').trim(),
      documentNumber: String(row.DocumentNum || row.Document || '').trim(),
      candidateTransactions: candidates,
    };
  }

  private async fetchSettledInvoicesByJournalLine(
    company: string,
    journalBatchNumber: string,
    lineNumbers: number[],
  ): Promise<Map<number, VendorPaymentSettledInvoiceRow[]>> {
    const result = new Map<number, VendorPaymentSettledInvoiceRow[]>();
    const uniqueLineNumbers = [
      ...new Set(lineNumbers.filter((line) => line > 0)),
    ];
    if (uniqueLineNumbers.length === 0) return result;

    const lineFilter = `(${this.queryBuilder.or(
      ...uniqueLineNumbers.map((lineNumber) =>
        this.queryBuilder.eq('JournalLineNumber', lineNumber),
      ),
    )})`;

    let endpoint = this.queryBuilder.buildQuery(
      '/data/VendorPaymentJournalLineSettledInvoices',
      {
        filter: this.queryBuilder.and(
          this.queryBuilder.eq('JournalLineCompany', company),
          this.queryBuilder.eq('JournalBatchNumber', journalBatchNumber),
          lineFilter,
        ),
        select: [
          'JournalLineCompany',
          'JournalBatchNumber',
          'JournalLineNumber',
          'InvoiceNumber',
          'InvoiceCompany',
          'InvoiceDueDate',
          'SettlementAmountInInvoiceCurrency',
          'CashDiscountToTakeInInvoiceCurrency',
          'invoiceAccount',
          'AccountDisplayValue',
        ],
        crossCompany: true,
      },
    );

    while (true) {
      const response =
        await this.d365foClient.get<VendorPaymentSettledInvoiceRow>(endpoint, {
          useCache: false,
        });
      for (const row of response.value ?? []) {
        const lineNumber = this.readNumber(row.JournalLineNumber);
        if (!lineNumber) continue;
        const bucket = result.get(lineNumber) ?? [];
        bucket.push(row);
        result.set(lineNumber, bucket);
      }
      const nextLink = response['@odata.nextLink'];
      if (!nextLink) break;
      endpoint = this.getEndpointFromNextLink(nextLink);
    }

    return result;
  }

  private findMatchingSettlementRow(
    rows: VendorPaymentSettledInvoiceRow[],
    target: VendorPaymentJournalSettlementTarget,
  ): VendorPaymentSettledInvoiceRow | undefined {
    const invoice = this.normalizeInvoiceValue(target.invoiceNumber);
    const vendor = this.normalizeVendorAccount(target.vendorAccount);
    return rows.find(
      (row) =>
        this.normalizeInvoiceValue(row.InvoiceNumber) === invoice &&
        (this.normalizeVendorAccount(row.invoiceAccount) === vendor ||
          this.normalizeVendorAccount(row.AccountDisplayValue) === vendor),
    );
  }

  /**
   * D365 permits an invoice to be marked by only one payment journal line at
   * a time. Combine net payment, withholding companion, and other split lines
   * for the same vendor invoice into one gross settlement amount.
   */
  private aggregateVendorPaymentSettlementTargets(
    targets: VendorPaymentJournalSettlementTarget[],
  ): AggregatedVendorPaymentJournalSettlementTarget[] {
    const groups = new Map<string, VendorPaymentJournalSettlementTarget[]>();
    for (const target of targets) {
      const key = [
        target.vendorAccount,
        target.invoiceNumber,
        target.documentNumber,
        target.currencyCode,
      ]
        .map((value) =>
          String(value ?? '')
            .trim()
            .toLowerCase(),
        )
        .join('|');
      const group = groups.get(key) ?? [];
      group.push(target);
      groups.set(key, group);
    }

    return [...groups.values()].map((group) => {
      const primary = [...group].sort(
        (left, right) =>
          Math.abs(
            Number(right.creditAmount ?? 0) - Number(right.debitAmount ?? 0),
          ) -
          Math.abs(
            Number(left.creditAmount ?? 0) - Number(left.debitAmount ?? 0),
          ),
      )[0];
      const settlementAmount = group.reduce(
        (sum, target) =>
          sum +
          Number(target.creditAmount ?? 0) -
          Number(target.debitAmount ?? 0),
        0,
      );
      return {
        ...primary,
        debitAmount: settlementAmount < 0 ? Math.abs(settlementAmount) : 0,
        creditAmount: settlementAmount > 0 ? settlementAmount : 0,
        lineNumbers: group.map((target) => target.lineNumber),
        uniqueIds: this.collectSettlementUniqueIds(group),
        sourceLineNumbers: this.collectSettlementSourceLineNumbers(group),
        settlementAmount,
      };
    });
  }

  private collectSettlementUniqueIds(
    targets: VendorPaymentJournalSettlementTarget[],
  ): string[] {
    return [
      ...new Set(
        targets
          .map((target) => String(target.uniqueId ?? '').trim())
          .filter((uniqueId) => uniqueId.length > 0),
      ),
    ];
  }

  private collectSettlementSourceLineNumbers(
    targets: VendorPaymentJournalSettlementTarget[],
  ): number[] {
    return [
      ...new Set(
        targets
          .map((target) => Number(target.sourceLineNumber))
          .filter((lineNumber) => Number.isFinite(lineNumber) && lineNumber > 0),
      ),
    ];
  }

  private describeSettlementTarget(
    target: VendorPaymentJournalSettlementTarget & { uniqueIds?: string[] },
  ): string {
    const uniqueIds = [
      ...new Set(
        [...(target.uniqueIds ?? []), String(target.uniqueId ?? '').trim()].filter(
          (uniqueId) => uniqueId.length > 0,
        ),
      ),
    ];
    const uniqueIdSuffix =
      uniqueIds.length === 0
        ? ''
        : uniqueIds.length === 1
          ? ` (Excel UniqueId ${uniqueIds[0]})`
          : ` (Excel UniqueIds ${uniqueIds.join(', ')})`;
    return `cash-out line ${target.lineNumber}${uniqueIdSuffix}`;
  }

  private async updateVendorPaymentJournalLineSettlement(
    company: string,
    journalBatchNumber: string,
    lineNumber: number,
    existing: VendorPaymentSettledInvoiceRow,
    settlementAmount: number,
  ): Promise<void> {
    const invoiceNumber = String(existing.InvoiceNumber ?? '').trim();
    const invoiceCompany = String(existing.InvoiceCompany ?? company).trim();
    const invoiceDueDate = String(existing.InvoiceDueDate ?? '').trim();
    if (!invoiceNumber || !invoiceDueDate) {
      throw new Error(
        `Existing settlement for line ${lineNumber} is missing its invoice key.`,
      );
    }
    const escapeKey = (value: string) => value.replace(/'/g, "''");
    const endpoint =
      `/data/VendorPaymentJournalLineSettledInvoices(` +
      `JournalLineCompany='${escapeKey(company)}',` +
      `JournalBatchNumber='${escapeKey(journalBatchNumber)}',` +
      `JournalLineNumber=${lineNumber},` +
      `InvoiceNumber='${escapeKey(invoiceNumber)}',` +
      `InvoiceCompany='${escapeKey(invoiceCompany)}',` +
      `InvoiceDueDate=${invoiceDueDate})?cross-company=true`;

    await this.d365foClient.patch<
      Pick<
        VendorPaymentJournalSettlementPayload,
        'SettlementAmountInInvoiceCurrency'
      >,
      unknown
    >(
      endpoint,
      { SettlementAmountInInvoiceCurrency: settlementAmount },
      { headers: { 'If-Match': '*' } },
    );
  }

  private async findOpenInvoiceForJournalSettlement(
    company: string,
    target: VendorPaymentJournalSettlementTarget,
  ): Promise<VendTransLookupRow> {
    const endpoint = this.queryBuilder.buildQuery('/data/VendTransBiEntities', {
      top: 20,
      select: [
        'Invoice',
        'AccountNum',
        'CurrencyCode',
        'Closed',
        'AmountCur',
        'AmountMST',
        'SettleAmountCur',
        // VendTransBiEntity does not expose RemainAmountCur. The remaining
        // balance is derived below from AmountCur minus SettleAmountCur.
        'DocumentNum',
        'DueDate',
      ],
      filter: this.queryBuilder.and(
        this.queryBuilder.eq('dataAreaId', company),
        this.queryBuilder.eq('AccountNum', target.vendorAccount),
        this.queryBuilder.eq('Invoice', target.invoiceNumber),
      ),
      crossCompany: true,
    });
    const response = await this.d365foClient.get<VendTransLookupRow>(endpoint, {
      useCache: false,
    });
    const requestedDocument = String(target.documentNumber ?? '')
      .trim()
      .toLowerCase();
    const requestedCurrency = String(target.currencyCode ?? '')
      .trim()
      .toLowerCase();
    const candidates = (response.value ?? []).filter((row) => {
      const isOpen = this.readClosedState(row.Closed) !== true;
      const documentMatches =
        !requestedDocument ||
        String(row.DocumentNum ?? '')
          .trim()
          .toLowerCase() === requestedDocument;
      const currencyMatches =
        !requestedCurrency ||
        String(row.CurrencyCode ?? '')
          .trim()
          .toLowerCase() === requestedCurrency;
      return isOpen && documentMatches && currencyMatches;
    });

    if (candidates.length !== 1) {
      throw new Error(
        `Expected one open invoice transaction for vendor ${target.vendorAccount}, invoice ${target.invoiceNumber}, and document ${target.documentNumber || '(empty)'}, but found ${candidates.length} (${this.describeSettlementTarget(target)}).`,
      );
    }
    return candidates[0];
  }

  private async fetchVendorPaymentJournalLinesByNumber(
    company: string,
    journalBatchNumber: string,
    lineNumbers: number[],
  ): Promise<Map<number, VendorPaymentJournalLineLookupRow>> {
    const result = new Map<number, VendorPaymentJournalLineLookupRow>();
    const uniqueLineNumbers = [
      ...new Set(lineNumbers.filter((line) => line > 0)),
    ];
    if (uniqueLineNumbers.length === 0) return result;

    const lineFilter = `(${this.queryBuilder.or(
      ...uniqueLineNumbers.map((lineNumber) =>
        this.queryBuilder.eq('LineNumber', lineNumber),
      ),
    )})`;

    let endpoint = this.queryBuilder.buildQuery(
      '/data/VendorPaymentJournalLines',
      {
        filter: this.queryBuilder.and(
          this.queryBuilder.eq('dataAreaId', company),
          this.queryBuilder.eq('JournalBatchNumber', journalBatchNumber),
          lineFilter,
        ),
        select: [
          'LineNumber',
          'MarkedInvoice',
          'SettleVoucher',
          'AccountDisplayValue',
          'CurrencyCode',
          'DebitAmount',
          'CreditAmount',
          'PaymentId',
          'TransactionText',
        ],
        crossCompany: true,
      },
    );

    while (true) {
      const response =
        await this.d365foClient.get<VendorPaymentJournalLineLookupRow>(
          endpoint,
          {
            useCache: false,
          },
        );
      for (const row of response.value ?? []) {
        const lineNumber = this.readNumber(row.LineNumber);
        if (!lineNumber) continue;
        result.set(lineNumber, row);
      }
      const nextLink = response['@odata.nextLink'];
      if (!nextLink) break;
      endpoint = this.getEndpointFromNextLink(nextLink);
    }

    return result;
  }

  private normalizeVendorAccount(value: unknown): string {
    return normalizeVendorLookupText(value).toLowerCase();
  }

  private normalizeInvoiceValue(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }
    if (typeof value === 'number') {
      return String(value).trim().toLowerCase();
    }
    return '';
  }

  private readNoYes(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized =
      typeof value === 'string'
        ? value.trim().toLowerCase()
        : typeof value === 'number'
          ? String(value).trim().toLowerCase()
          : '';
    if (!normalized) return null;
    if (['yes', 'true', '1'].includes(normalized)) return true;
    if (['no', 'false', '0'].includes(normalized)) return false;
    return null;
  }

  /** VendTrans `Closed` is a date, with 1900-01-01 representing open. */
  private readClosedState(value: unknown): boolean | null {
    const noYes = this.readNoYes(value);
    if (noYes !== null) return noYes;
    if (typeof value !== 'string' || !value.trim()) return null;

    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return null;
    const date = new Date(timestamp);
    return date.getUTCFullYear() > 1900;
  }

  private resolveRemainingAmount(
    row: VendTransLookupRow,
    originalAmount: number | null,
  ): number | null {
    const explicitRemaining = this.firstDefinedNumber(
      row.RemainAmountCur,
      row.RemainAmountMST,
      row.RemainAmountReportingCurrency,
    );
    if (explicitRemaining !== null) return Math.abs(explicitRemaining);

    const settledAmount = this.firstDefinedNumber(
      row.SettleAmountCur,
      row.SettleAmountMST,
      row.SettleAmountReporting,
    );
    if (originalAmount === null) return null;
    if (settledAmount === null) return Math.abs(originalAmount);
    return Math.max(0, Math.abs(originalAmount) - Math.abs(settledAmount));
  }

  private readNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private firstDefinedNumber(...values: unknown[]): number | null {
    for (const value of values) {
      if (value === undefined || value === null || value === '') continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }

  private getEndpointFromNextLink(nextLink: string): string {
    try {
      const url = new URL(nextLink);
      return `${url.pathname}${url.search}`;
    } catch {
      return nextLink;
    }
  }

  /**
   * Post vendor invoice journal header to D365FO (single header)
   * @param data Header request
   * @returns Created header response with JournalBatchNumber
   */
  public async postHeader(
    data: D365FOVendorInvoiceJournalHeaderRequest,
  ): Promise<D365FOVendorInvoiceJournalHeaderResponse> {
    this.logger.log(`[HEADER] Creating header for company: ${data.dataAreaId}`);

    const { JournalBatchNumber: _omit, ...payload } = data;

    return this.d365foClient.post<
      Omit<D365FOVendorInvoiceJournalHeaderRequest, 'JournalBatchNumber'>,
      D365FOVendorInvoiceJournalHeaderResponse
    >('/data/VendInvoiceJournalHeaders', payload);
  }

  /**
   * Post lines for a specific header (chunked, sequential, no parallel)
   * Includes idempotency checks to avoid posting duplicate lines
   * @param headerKey JournalBatchNumber of the header
   * @param lines Array of line requests for this header
   * @param chunkSize Number of lines to post per chunk (default: 20)
   * @param dataAreaId Company data area ID (required for idempotency checks)
   * @returns Array of successfully posted line identifiers
   */
  public async postLinesForHeader(
    headerKey: string,
    lines: D365FOVendorInvoiceJournalLineRequest[],
    chunkSize: number = 20,
    dataAreaId?: string,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    // Line attachment / request shaping: set JournalBatchNumber, strip FullPrimaryRemittanceAddress (D365FO services only)
    const shapedLines = lines.map((line) => {
      const { FullPrimaryRemittanceAddress, ...rest } = line as any;
      return {
        ...rest,
        JournalBatchNumber: headerKey,
      } as D365FOVendorInvoiceJournalLineRequest;
    });

    this.logger.log(
      `[LINES] Posting ${shapedLines.length} lines for header ${headerKey} in chunks of ${chunkSize}`,
    );

    // Check for existing lines to avoid duplicate posting (idempotency)
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
        // If query fails, log warning but continue (might be first time posting)
        this.logger.warn(
          `[LINES] Could not query existing lines for header ${headerKey}, proceeding without idempotency check: ${this.dfoErrorExtractor.extractMessage(error)}`,
        );
      }
    }

    const successfullyPosted: Array<{
      headerId: string;
      lineNumber: number;
    }> = [];

    // Process in chunks sequentially (no parallel within chunk)
    for (let i = 0; i < shapedLines.length; i += chunkSize) {
      const chunk = shapedLines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.log(
        `[LINES] Processing chunk ${chunkNumber}/${totalChunks} for header ${headerKey} (${chunk.length} lines)`,
      );

      // Post lines sequentially within chunk (no parallel)
      // Add small delay between line posts to allow D365FO internal processes to complete
      for (const line of chunk) {
        // Skip if line already exists (idempotency check)
        if (existingLines.has(line.LineNumber)) {
          this.logger.debug(
            `[LINES] Skipping line ${line.LineNumber} for header ${headerKey} - already exists`,
          );
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
          this.logger.debug(
            `[LINES] Posted line ${line.LineNumber} for header ${headerKey}`,
          );

          // Add delay between line posts to allow D365FO internal processes (validation, workflow) to complete
          // This reduces the chance of RecVersion conflicts
          if (line !== chunk[chunk.length - 1]) {
            // Don't delay after the last line in chunk
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        } catch (error) {
          const errorDetails = this.dfoErrorExtractor.extractMessage(error);
          this.logger.error(
            `[LINES] Failed to post line ${line.LineNumber} for header ${headerKey} in chunk ${chunkNumber}: ${errorDetails}`,
            error instanceof Error ? error.stack : undefined,
          );
          throw new Error(
            `Failed to post line ${line.LineNumber} for header ${headerKey}: ${errorDetails}`,
          );
        }
      }

      this.logger.log(
        `[LINES] Completed chunk ${chunkNumber}/${totalChunks} for header ${headerKey} (${chunk.length} lines posted)`,
      );
    }

    this.logger.log(
      `[LINES] Successfully posted all ${shapedLines.length} lines for header ${headerKey}`,
    );

    return successfullyPosted;
  }

  /**
   * Query and list all lines for a specific header from D365FO
   * @param headerKey JournalBatchNumber of the header
   * @param dataAreaId Company data area ID
   * @returns Array of line objects with LineNumber
   */
  public async listLinesForHeader(
    headerKey: string,
    dataAreaId: string,
  ): Promise<Array<{ LineNumber: number }>> {
    this.logger.debug(
      `[QUERY] Querying lines for header ${headerKey} in company ${dataAreaId}`,
    );

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', dataAreaId),
      this.queryBuilder.eq('JournalBatchNumber', headerKey),
    );

    const query = this.queryBuilder.buildQuery(
      '/data/VendInvoiceJournalLines',
      {
        filter,
        select: ['LineNumber'],
        crossCompany: true,
      },
    );

    try {
      const response = await this.d365foClient.get<{ LineNumber: number }>(
        query,
        {
          useCache: false,
        },
      );

      const lines = response.value || [];
      this.logger.debug(
        `[QUERY] Found ${lines.length} lines for header ${headerKey}`,
      );

      return lines;
    } catch (error) {
      const errorDetails = this.dfoErrorExtractor.extractMessage(error);
      this.logger.error(
        `[QUERY] Failed to query lines for header ${headerKey}: ${errorDetails}`,
      );
      throw error;
    }
  }

  /**
   * Post vendor invoice journal line to D365FO
   * Includes retry logic with exponential backoff for concurrency conflicts
   */
  public async postLine(
    data: D365FOVendorInvoiceJournalLineRequest,
  ): Promise<any> {
    this.logger.debug(
      `Posting vendor invoice journal line for company: ${data.dataAreaId}, batch: ${data.JournalBatchNumber}, line: ${data.LineNumber}`,
    );

    // Remove FullPrimaryRemittanceAddress from line body before posting
    const {
      FullPrimaryRemittanceAddress,
      Voucher: _omitVoucher,
      ...lineData
    } = data as any;

    // Use retry service with custom condition for concurrency conflicts
    return this.retryService.executeWithRetry(
      async () => {
        return await this.d365foClient.post<any, any>(
          '/data/VendInvoiceJournalLines',
          lineData,
        );
      },
      {
        retries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryCondition: (error: any) => {
          if (!error.response) return true;
          const status = error.response?.status;
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
   * Post multiple vendor invoice journal headers in chunks
   * @param headers Array of header requests
   * @param chunkSize Number of headers to post per chunk (default: 10)
   * @returns Array of JournalBatchNumbers (as strings)
   */
  public async postHeadersBatch(
    headers: D365FOVendorInvoiceJournalHeaderRequest[],
    chunkSize: number = 10,
  ): Promise<string[]> {
    this.logger.debug(
      `Posting ${headers.length} headers in chunks of ${chunkSize}`,
    );

    const journalBatchNumbers: string[] = [];

    // Process in chunks
    for (let i = 0; i < headers.length; i += chunkSize) {
      const chunk = headers.slice(i, i + chunkSize);
      this.logger.debug(
        `Posting chunk ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(headers.length / chunkSize)} (${chunk.length} headers)`,
      );

      // Post headers in parallel within chunk
      const chunkPromises = chunk.map((header) => this.postHeader(header));
      const chunkResults = await Promise.all(chunkPromises);

      // Extract JournalBatchNumbers from responses
      for (const result of chunkResults) {
        const journalBatchNumber = result?.JournalBatchNumber;
        if (journalBatchNumber) {
          journalBatchNumbers.push(journalBatchNumber);
        } else {
          this.logger.warn(
            'Header posted but JournalBatchNumber not found in response',
            JSON.stringify(result),
          );
        }
      }
    }

    this.logger.debug(
      `Successfully posted ${journalBatchNumbers.length} headers`,
    );
    return journalBatchNumbers;
  }

  /**
   * Post multiple vendor invoice journal lines in chunks
   * @param lines Array of line requests
   * @param chunkSize Number of lines to post per chunk (default: 20)
   * @returns Array of successfully posted line identifiers
   * @throws Error if any line fails - caller should rollback headers and successfully posted lines
   */
  public async postLinesBatch(
    lines: D365FOVendorInvoiceJournalLineRequest[],
    chunkSize: number = 20,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    this.logger.debug(
      `Posting ${lines.length} lines in chunks of ${chunkSize}`,
    );

    const successfullyPosted: Array<{
      headerId: string;
      lineNumber: number;
    }> = [];

    // Process in chunks
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.debug(
        `Posting chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
      );

      try {
        // Post lines in parallel within chunk, tracking successes
        const chunkPromises = chunk.map(async (line) => {
          await this.postLine(line);
          return {
            headerId: line.JournalBatchNumber,
            lineNumber: line.LineNumber,
          };
        });

        const chunkResults = await Promise.all(chunkPromises);
        successfullyPosted.push(...chunkResults);

        this.logger.debug(
          `Successfully posted chunk ${chunkNumber} (${chunk.length} lines)`,
        );
      } catch (error: unknown) {
        const errorDetails = this.dfoErrorExtractor.extractMessage(error);

        if (isAxiosError(error) && error.response?.data) {
          this.logger.error(
            `D365FO error response: ${JSON.stringify(error.response.data)}`,
          );
        }

        this.logger.error(
          `Failed to post chunk ${chunkNumber} of ${totalChunks}: ${errorDetails}`,
          error instanceof Error ? error.stack : undefined,
        );

        let errorMessage = `Failed to post lines in chunk ${chunkNumber}: ${errorDetails}`;

        if (successfullyPosted.length > 0) {
          errorMessage += `. ${successfullyPosted.length} lines were posted successfully before failure. Rollback required.`;
          this.logger.warn(
            `Successfully posted ${successfullyPosted.length} lines before failure. Rollback required.`,
          );
        } else {
          errorMessage += `. No lines were posted successfully.`;
          this.logger.warn(
            `No lines were posted successfully in chunk ${chunkNumber}. Only headers need rollback.`,
          );
        }

        // Re-throw to trigger rollback in processor
        throw new Error(errorMessage);
      }
    }

    this.logger.debug(
      `Successfully posted all ${lines.length} lines (${successfullyPosted.length} tracked)`,
    );

    return successfullyPosted;
  }

  /**
   * Delete a vendor invoice journal header (for rollback)
   * Includes retry logic for concurrency conflicts
   * @param journalBatchNumber The JournalBatchNumber of the header to delete
   * @param dataAreaId The company data area ID
   */
  public async deleteHeader(
    journalBatchNumber: string,
    dataAreaId: string,
  ): Promise<void> {
    this.logger.debug(
      `[DELETE] Deleting vendor invoice journal header ${journalBatchNumber} for company: ${dataAreaId}`,
    );

    // D365FO uses JournalBatchNumber for deletion
    // Format: /data/VendInvoiceJournalHeaders(dataAreaId='m-p',JournalBatchNumber='Mesco-000001956')
    const endpoint = `/data/VendInvoiceJournalHeaders(dataAreaId='${dataAreaId}',JournalBatchNumber='${journalBatchNumber}')?cross-company=true`;

    // Use retry service with custom condition for concurrency conflicts
    await this.retryService.executeWithRetry(
      async () => {
        const response = await this.d365foClient.delete(endpoint);
        // Verify deletion response (should be empty or 204)
        if (response !== undefined && response !== null) {
          this.logger.debug(
            `[DELETE] Header ${journalBatchNumber} deleted successfully`,
          );
        }
      },
      {
        retries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryCondition: (error: any) => {
          if (!error.response) return true;
          const status = error.response?.status;
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
   * Delete a vendor invoice journal line (for rollback)
   * Includes retry logic for concurrency conflicts
   * @param journalBatchNumber The JournalBatchNumber of the line to delete
   * @param lineNumber The LineNumber of the line to delete
   * @param dataAreaId The company data area ID
   */
  public async deleteLine(
    journalBatchNumber: string,
    lineNumber: number,
    dataAreaId: string,
  ): Promise<void> {
    this.logger.debug(
      `[DELETE] Deleting vendor invoice journal line ${lineNumber} for journal ${journalBatchNumber} in company: ${dataAreaId}`,
    );

    // Format: /data/VendInvoiceJournalLines(dataAreaId='m-p',JournalBatchNumber='Mesco-000010002',LineNumber=1)?cross-company=true
    const endpoint = `/data/VendInvoiceJournalLines(dataAreaId='${dataAreaId}',JournalBatchNumber='${journalBatchNumber}',LineNumber=${lineNumber})?cross-company=true`;

    // Use retry service with custom condition for concurrency conflicts
    await this.retryService.executeWithRetry(
      async () => {
        const response = await this.d365foClient.delete(endpoint);
        // Verify deletion response (should be empty or 204)
        if (response !== undefined && response !== null) {
          this.logger.debug(
            `[DELETE] Line ${lineNumber} for journal ${journalBatchNumber} deleted successfully`,
          );
        }
      },
      {
        retries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryCondition: (error: any) => {
          if (!error.response) return true;
          const status = error.response?.status;
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
   * Delete multiple vendor invoice journal lines in chunks
   * @param lines Array of line identifiers to delete
   * @param dataAreaId The company data area ID
   * @param chunkSize Number of lines to delete per chunk (default: 20)
   * @returns Array of results indicating success/failure for each line
   */
  public async deleteLinesBatch(
    lines: Array<{ journalBatchNumber: string; lineNumber: number }>,
    dataAreaId: string,
    chunkSize: number = 20,
  ): Promise<
    Array<{
      journalBatchNumber: string;
      lineNumber: number;
      success: boolean;
      error?: string;
    }>
  > {
    this.logger.debug(
      `Deleting ${lines.length} lines in chunks of ${chunkSize}`,
    );

    const results: Array<{
      journalBatchNumber: string;
      lineNumber: number;
      success: boolean;
      error?: string;
    }> = [];

    // Process in chunks
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.debug(
        `Deleting chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
      );

      // Delete lines in parallel within chunk
      const deletePromises = chunk.map(async (line) => {
        try {
          await this.deleteLine(
            line.journalBatchNumber,
            line.lineNumber,
            dataAreaId,
          );
          return {
            journalBatchNumber: line.journalBatchNumber,
            lineNumber: line.lineNumber,
            success: true,
          };
        } catch (error) {
          const errorMessage = this.dfoErrorExtractor.extractMessage(error);
          this.logger.error(
            `Failed to delete line ${line.lineNumber} for journal ${line.journalBatchNumber}: ${errorMessage}`,
          );
          return {
            journalBatchNumber: line.journalBatchNumber,
            lineNumber: line.lineNumber,
            success: false,
            error: errorMessage,
          };
        }
      });

      const chunkResults = await Promise.all(deletePromises);
      results.push(...chunkResults);
    }

    const successCount = results.filter((r) => r.success).length;
    this.logger.debug(
      `Line deletion completed: ${successCount} succeeded, ${results.length - successCount} failed`,
    );

    return results;
  }
}
