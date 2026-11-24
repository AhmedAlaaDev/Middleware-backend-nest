import { createHash, randomUUID } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  MasRevenueCashAccountVerifier,
  masRevenueCashAccountBlockers,
  receiptCurrenciesByCashId,
  type MasRevenueCashAccountCheck,
} from './mas-revenue-cash-account-verifier';
import {
  getMasRevenueSubmissionBlockers,
  type MasRevenueVerifiedConfig,
} from './mas-revenue-config';
import { MasRevenueConfigProvider } from './mas-revenue-config.provider';
import {
  masRevenueFingerprint,
  masRevenueIdentity,
  reliableYear,
  MAS_REVENUE_IDENTITY_VERSION,
} from './mas-revenue-identity';
import {
  evaluateMasRevenueReceiptIdentities,
  type MasRevenueIdentityConflict,
  type MasRevenuePriorReceipt,
} from './mas-revenue-identity-policy';
import { normalizeMasRevenueRows } from './mas-revenue-normalizer';
import {
  MasRevenueReviewLineRecord,
  MasRevenueReviewRecord,
  MasRevenueReviewStore,
} from './mas-revenue-review.store';
import {
  receiptToStoredRaw,
  storedRawToReceipt,
  type MasRevenueStoredRaw,
} from './mas-revenue-stored';
import {
  normalizeSourceText,
  parseMasRevenueWorkbook,
} from './mas-revenue-workbook.parser';
import {
  MAS_REVENUE_COMPANY_ID,
  MAS_REVENUE_TEMPLATE_VERSION,
} from './mas-revenue.constants';
import {
  MasRevenueError,
  type MasRevenueReceipt,
  MasRevenueRowIssue,
} from './mas-revenue.types';

import { CashInMasRevenueEntryProcessor } from '@/modules/cash/processors/inbound/mas-revenue/cash-in-mas-revenue-entry.processor';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import {
  EntryDynDataModel,
  EntryRawDataModel,
} from '@/modules/entry-processor/models';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';

/** Issues returned in the preview. The full count is always reported. */
const MAX_ISSUES_IN_SUMMARY = 500;

export interface MasRevenueUser {
  id: string;
  role?: string;
}

export interface MasRevenueReviewView {
  reviewId: string;
  company: string;
  fileName: string;
  templateVersion: number;
  status: MasRevenueReviewRecord['status'];
  /** Submit is possible only when the file has no row issues AND configuration is complete. */
  canSubmit: boolean;
  /** The upload itself is valid (no row issues). Configuration blockers are listed separately. */
  uploadValid: boolean;
  reviewVersion: number;
  payloadHash: string;
  receiptCount: number;
  summary: Record<string, unknown> | null;
  /** Configuration gates that currently block submission. */
  blockers: string[];
  batchId: string | null;
  submittedAt: Date | null;
  lastError: string | null;
  correlationId: string;
}

export interface MasRevenueLinesView {
  reviewId: string;
  page: number;
  pageSize: number;
  total: number;
  items: Array<{
    position: number;
    sourceRow: number;
    invoiceNumber: string;
    transactionDate: string;
    currency: string;
    totalMajor: string;
    cashAccountDisplayName: string;
    customerName: string;
  }>;
}

export interface MasRevenueSubmitInput {
  reviewVersion: number;
  payloadHash: string;
  idempotencyKey: string;
}

/**
 * Staged MAS Revenue Cash In review.
 *
 *   preview  parse, normalize and store an immutable snapshot. No batch, no D365 call.
 *   submit   verify the snapshot and configuration, then create the Cash In batch.
 *            Sending the batch to D365 is a separate step (PostToDFO).
 */
@Injectable()
export class MasRevenueReviewService {
  constructor(
    private readonly store: MasRevenueReviewStore,
    private readonly configProvider: MasRevenueConfigProvider,
    private readonly dataBatchService: DataBatchService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly operationalLogs: OperationalLoggerService,
    private readonly cashVerifier: MasRevenueCashAccountVerifier,
  ) {}

  public async preview(input: {
    fileBuffer: Buffer;
    fileName: string;
    companyId: string;
    templateVersion: number;
    user: MasRevenueUser;
  }): Promise<MasRevenueReviewView> {
    assertCompany(input.companyId);
    assertTemplateVersion(input.templateVersion);

    let parsed;
    let result;
    try {
      parsed = await parseMasRevenueWorkbook(input.fileBuffer);
      result = normalizeMasRevenueRows(parsed);
    } catch (error) {
      if (error instanceof MasRevenueError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    // Each receipt takes the currency of its verified D365 cash account (read-only).
    // A receipt whose account cannot be resolved keeps an empty currency and blocks
    // submit with a named blocker. It is never given a guessed currency.
    const { config } = this.configProvider.current();
    const cashAccountChecks = await this.cashVerifier.verify(
      Object.values(config.cashAccountIdsByDisplayName),
    );
    const receipts = resolveReceiptCurrencies(
      result.receipts,
      config,
      cashAccountChecks,
    );
    const rawRows = receipts.map((receipt, index) =>
      receiptToStoredRaw(receipt, index + 1),
    );
    const payloadHash = hashSnapshot(input.templateVersion, rawRows);
    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.CashInMasRevenue,
    ) as CashInMasRevenueEntryProcessor;
    const groups = await processor.formatAndEnrichAsync(
      rawRows as unknown as EntryRawDataModel[],
      MAS_REVENUE_COMPANY_ID,
    );

    const uploadValid = result.issues.length === 0 && receipts.length > 0;
    // Preview runs the same read-only cash-account check as submit, so the user sees
    // unknown, bank-only, mismatched or unverifiable accounts before submitting.
    // Submit and posting still recheck live; this result never replaces them.
    const summary = {
      cashAccountChecks,
      sourceSheet: parsed.sourceSheet,
      headerRow: parsed.headerRow,
      scannedDataRows: parsed.scannedRowCount - parsed.headerRow,
      nonTransactionRows: result.nonTransactionRows,
      accounting: result.accounting,
      totalsByCurrency: totalsByCurrency(rawRows),
      journalGroups: groupCounts(groups),
      issueCount: result.issues.length,
      issues: result.issues.slice(0, MAX_ISSUES_IN_SUMMARY).map(toIssueView),
    };

    const correlationId = randomUUID();
    const record = await this.store.createReview({
      company: MAS_REVENUE_COMPANY_ID,
      createdByUserId: input.user.id,
      fileName: input.fileName,
      templateVersion: input.templateVersion,
      payloadHash,
      summary,
      canSubmit: uploadValid,
      receiptCount: receipts.length,
      correlationId,
    });
    await this.store.insertLines(
      rawRows.map(
        (raw): MasRevenueReviewLineRecord => ({
          reviewId: record.id,
          company: MAS_REVENUE_COMPANY_ID,
          position: raw.LINENUMBER,
          invoiceNumber: raw.InvoiceNumber,
          transactionDate: raw.TransactionDate,
          currency: raw.Currency,
          raw,
          batchId: null,
        }),
      ),
    );

    await this.operationalLogs.emit({
      level: uploadValid ? 'info' : 'warn',
      message: uploadValid
        ? `MAS Revenue review ready: ${receipts.length} receipt(s)`
        : `MAS Revenue review has ${result.issues.length} row issue(s)`,
      context: MasRevenueReviewService.name,
      eventType: 'mas_revenue.review',
      jobId: record.id,
      status: uploadValid ? 'validated' : 'blocked',
      metadata: {
        receiptCount: receipts.length,
        issueCount: result.issues.length,
      },
    });

    return this.toView({ ...record, canSubmit: uploadValid }, rawRows, summary);
  }

  public async getReview(
    reviewId: string,
    user: MasRevenueUser,
  ): Promise<MasRevenueReviewView> {
    const record = await this.loadOwnedReview(reviewId, user);
    const lines = await this.store.findLines(reviewId);
    return this.toView(
      record,
      lines.map((line) => line.raw),
      record.summary,
    );
  }

  public async getLines(
    reviewId: string,
    user: MasRevenueUser,
    page: number,
    pageSize: number,
  ): Promise<MasRevenueLinesView> {
    await this.loadOwnedReview(reviewId, user);
    const safePage = Math.max(1, Math.floor(page));
    const safeSize = Math.min(200, Math.max(1, Math.floor(pageSize)));
    const result = await this.store.pageLines(reviewId, safePage, safeSize);
    return {
      reviewId,
      page: safePage,
      pageSize: safeSize,
      total: result.total,
      items: result.items.map((line) => ({
        position: line.position,
        sourceRow: line.raw.SourceRow,
        invoiceNumber: line.invoiceNumber,
        transactionDate: line.transactionDate,
        currency: line.currency,
        totalMajor: minorText(line.raw.TotalMinor),
        cashAccountDisplayName: line.raw.CashAccountDisplayName,
        customerName: line.raw.CustomerName,
      })),
    };
  }

  /**
   * Creates the Cash In batch for a reviewed snapshot. Nothing is sent to D365 here.
   *
   * Checks, in order: owner or admin; a repeated key returns the batch it created;
   * the review is in a submittable state; reviewVersion and payloadHash match the
   * stored snapshot; configuration gates pass; no invoice of this company is
   * already in another batch. Only then is the state claimed and the batch created.
   */
  public async submit(
    reviewId: string,
    input: MasRevenueSubmitInput,
    user: MasRevenueUser,
  ): Promise<MasRevenueReviewView> {
    const record = await this.loadOwnedReview(reviewId, user);

    if (record.batchId && record.submitKey === input.idempotencyKey) {
      return this.getReview(reviewId, user);
    }
    if (record.status === 'SUBMITTING') {
      throw new ConflictException('This review is already being submitted.');
    }
    if (record.batchId) {
      throw new ConflictException(
        `This review has already created batch ${record.batchId}. Upload the file again to create a new review.`,
      );
    }
    if (!record.canSubmit) {
      throw new ConflictException(
        'The review has row issues. Correct the file and upload it again.',
      );
    }
    if (input.reviewVersion !== 1) {
      throw new ConflictException('reviewVersion does not match this review.');
    }
    if (record.payloadHash !== input.payloadHash) {
      throw new ConflictException(
        'The reviewed snapshot does not match the payload hash. Review the file again.',
      );
    }

    const lines = await this.store.findLines(reviewId);
    const raws = lines.map((line) => line.raw);
    const receipts = raws.map(storedRawToReceipt);
    const { config } = this.configProvider.current();
    const blockers = getMasRevenueSubmissionBlockers(config, receipts);
    if (blockers.length > 0) {
      throw new ConflictException({
        message: 'Submission is blocked by MAS configuration.',
        blockers,
      });
    }

    // Read-only check of every configured cash ID against D365 (CashAccounts, then
    // BankAccounts). Unknown or bank-only IDs and currency mismatches block submission.
    const cashChecks = await this.cashVerifier.verify(
      Object.values(config.cashAccountIdsByDisplayName),
    );
    const cashBlockers = masRevenueCashAccountBlockers(
      cashChecks,
      receiptCurrenciesByCashId(config.cashAccountIdsByDisplayName, receipts),
    );
    if (cashBlockers.length > 0) {
      throw new ConflictException({
        message: 'Submission is blocked by MAS cash-account checks.',
        blockers: cashBlockers,
      });
    }

    // Snapshots from before identity version 2 carry no year-scoped identity. They
    // are refused, so a new submit never creates a legacy PaymentId.
    if (
      raws.some((raw) => raw.IdentityVersion !== MAS_REVENUE_IDENTITY_VERSION)
    ) {
      throw new ConflictException(
        'This review was created before the receipt identity was introduced. Upload the file again to create a new review.',
      );
    }

    // Identity checks against existing receipts (batches and in-progress claims).
    // The atomic reservation below is the final guard against concurrent submits.
    const invoices = [...new Set(receipts.map((r) => r.invoiceNumber))];
    const priors = await this.loadPriorReceipts(invoices);
    const evaluation = evaluateMasRevenueReceiptIdentities(receipts, priors);
    if (evaluation.conflicts.length > 0) {
      throw new ConflictException(identityConflictBody(evaluation.conflicts));
    }

    const claimed = await this.store.claimReview(
      reviewId,
      ['PREVIEWED', 'SUBMIT_FAILED'],
      'SUBMITTING',
      input.idempotencyKey,
    );
    if (!claimed) {
      throw new ConflictException(
        'This review is already being submitted or cannot be submitted.',
      );
    }

    // Reserve every receipt identity atomically (unique indexes). Two submits of the
    // same receipt cannot both succeed; the loser fails without creating a batch.
    const reservation = await this.store.claimReceiptIdentities(
      reviewId,
      evaluation.identities.map((identity, index) => ({
        company: MAS_REVENUE_COMPANY_ID,
        identityKey: identity.key,
        paymentIdBase: identity.paymentIdBase,
        invoiceNumber: identity.invoiceNumber,
        year: identity.year,
        fingerprint: masRevenueFingerprint(receipts[index]),
      })),
    );
    if (!reservation.ok) {
      const code =
        reservation.reason === 'PAYMENT_ID_TAKEN'
          ? 'PAYMENT_ID_COLLISION'
          : 'DUPLICATE_RECEIPT';
      const message =
        code === 'DUPLICATE_RECEIPT'
          ? 'A receipt with this company, source, year and invoice number was submitted at the same time or already exists.'
          : 'A generated PaymentId already belongs to another receipt. The submit is refused.';
      await this.store.updateReview(reviewId, {
        status: 'SUBMIT_FAILED',
        lastError: message,
      });
      throw new ConflictException({ message, code });
    }

    let batchId: string | null = null;
    try {
      const processor = this.processorFactory.getProcessorByName(
        EntryProcessorTypes.CashInMasRevenue,
      ) as CashInMasRevenueEntryProcessor;
      const enriched = await processor.formatAndEnrichAsync(
        raws as unknown as EntryRawDataModel[],
        MAS_REVENUE_COMPANY_ID,
      );
      const validated = processor.validateAsync(
        enriched,
        MAS_REVENUE_COMPANY_ID,
      );
      const lineErrors = validated.flatMap((line) => line.GetErrors());
      if (lineErrors.length > 0) {
        throw new Error(
          `MAS Revenue lines failed validation (${lineErrors.length}): ${lineErrors.slice(0, 3).join('; ')}`,
        );
      }

      const batch = await this.dataBatchService.createAsync(
        EntryProcessorTypes.CashInMasRevenue,
        ENTRY_PROCESSOR_NAMES.CASH_IN_MAS_REVENUE,
        MAS_REVENUE_COMPANY_ID,
        `MAS Revenue Cash In ${record.fileName}`.slice(0, 200),
        raws as unknown as EntryRawDataModel[],
        validated,
      );
      batchId = batch.id;
      await this.store.markLinesSubmitted(reviewId, batch.id);
      await this.store.attachBatchToReceiptClaims(reviewId, batch.id);
      await this.store.updateReview(reviewId, {
        status: 'BATCH_CREATED',
        batchId: batch.id,
        submittedAt: new Date(),
        lastError: null,
      });
    } catch (error) {
      if (!batchId) {
        // No batch exists, so the identities reserved for this review are released
        // and the same receipts can be submitted again with the same identity.
        await this.store.releaseUnbatchedReceiptClaims(reviewId);
      }
      await this.store.updateReview(reviewId, {
        status: batchId ? 'BATCH_CREATED' : 'SUBMIT_FAILED',
        lastError: safeMessage(error, 'batch could not be created'),
      });
      if (!batchId) {
        throw new BadRequestException(
          safeMessage(error, 'batch could not be created'),
        );
      }
    }

    await this.operationalLogs.emit({
      level: 'info',
      message: `MAS Revenue batch created: ${receipts.length} receipt(s)`,
      context: MasRevenueReviewService.name,
      eventType: 'mas_revenue.submit',
      jobId: reviewId,
      batchId: batchId ?? undefined,
      status: 'validated',
      metadata: { receiptCount: receipts.length },
    });
    return this.getReview(reviewId, user);
  }

  /**
   * Existing receipts for the invoice numbers, from batch lines (legacy and version 2)
   * and from identity claims (in progress or batched). Any year is included, so a
   * re-dated receipt is seen.
   */
  private async loadPriorReceipts(
    invoices: string[],
  ): Promise<MasRevenuePriorReceipt[]> {
    const [lines, claims] = await Promise.all([
      this.store.findSubmittedReceiptLines(MAS_REVENUE_COMPANY_ID, invoices),
      this.store.findReceiptClaims(MAS_REVENUE_COMPANY_ID, invoices),
    ]);
    const fromLines: MasRevenuePriorReceipt[] = lines.map((line) => {
      const year = reliableYear(line.transactionDate);
      const versioned =
        line.raw.IdentityVersion === MAS_REVENUE_IDENTITY_VERSION;
      return {
        invoiceNumber: line.invoiceNumber,
        year,
        fingerprint: masRevenueFingerprint(storedRawToReceipt(line.raw)),
        identityKey:
          versioned && year !== null
            ? masRevenueIdentity({
                transactionDate: line.transactionDate,
                invoiceNumber: line.invoiceNumber,
              }).key
            : null,
        reference: `batch ${line.batchId ?? 'unknown'}`,
      };
    });
    const fromClaims: MasRevenuePriorReceipt[] = claims.map((claim) => ({
      invoiceNumber: claim.invoiceNumber,
      year: claim.year,
      fingerprint: claim.fingerprint,
      identityKey: claim.identityKey,
      reference: claim.batchId
        ? `batch ${claim.batchId}`
        : `review ${claim.reviewId} (in progress)`,
    }));
    return [...fromLines, ...fromClaims];
  }

  private async loadOwnedReview(
    reviewId: string,
    user: MasRevenueUser,
  ): Promise<MasRevenueReviewRecord> {
    const record = await this.store.findReview(reviewId);
    if (!record) throw new NotFoundException('MAS Revenue review not found');
    if (
      record.createdByUserId !== user.id &&
      user.role?.toLowerCase() !== 'admin'
    ) {
      throw new ForbiddenException(
        'Only the uploader or an administrator can access this review.',
      );
    }
    return record;
  }

  private toView(
    record: MasRevenueReviewRecord,
    raws: MasRevenueStoredRaw[],
    summary: Record<string, unknown> | null,
  ): MasRevenueReviewView {
    const { config } = this.configProvider.current();
    const receipts = raws.map(storedRawToReceipt);
    const cashChecks = readCashChecks(summary);
    const blockers = [
      ...getMasRevenueSubmissionBlockers(config, receipts),
      ...masRevenueCashAccountBlockers(
        cashChecks,
        receiptCurrenciesByCashId(config.cashAccountIdsByDisplayName, receipts),
      ),
    ];
    const uploadValid = record.canSubmit;
    return {
      reviewId: record.id,
      company: record.company,
      fileName: record.fileName,
      templateVersion: record.templateVersion,
      status: record.status,
      canSubmit: uploadValid && blockers.length === 0 && !record.batchId,
      uploadValid,
      reviewVersion: 1,
      payloadHash: record.payloadHash,
      receiptCount: record.receiptCount,
      summary,
      blockers,
      batchId: record.batchId,
      submittedAt: record.submittedAt,
      lastError: record.lastError,
      correlationId: record.correlationId,
    };
  }
}

/**
 * The refusal body for identity conflicts. The most specific code wins: a duplicate
 * first, then an ambiguous record, then a re-dated receipt that needs correction.
 */
function identityConflictBody(conflicts: MasRevenueIdentityConflict[]) {
  const pick = (code: MasRevenueIdentityConflict['code']) =>
    conflicts.find((conflict) => conflict.code === code);
  const primary =
    pick('DUPLICATE_RECEIPT') ??
    pick('PAYMENT_ID_COLLISION') ??
    pick('RECONCILIATION_REQUIRED') ??
    pick('CORRECTION_REQUIRED');
  const messages: Record<MasRevenueIdentityConflict['code'], string> = {
    DUPLICATE_RECEIPT:
      'Receipt(s) already submitted: the same company, source, year and invoice number exist in another batch.',
    PAYMENT_ID_COLLISION:
      'A generated PaymentId belongs to another receipt. The submit is refused.',
    RECONCILIATION_REQUIRED:
      'Submission blocked: an existing record for an invoice has no reliable transaction date. Reconcile it first.',
    CORRECTION_REQUIRED:
      'Submission blocked: an invoice submitted in another year has the same content. This looks like a re-dated submitted receipt. Explicit correction handling is required and is not available in this flow.',
  };
  return {
    message: messages[primary?.code ?? 'DUPLICATE_RECEIPT'],
    code: primary?.code ?? 'DUPLICATE_RECEIPT',
    conflicts: conflicts.slice(0, 100),
  };
}

/** Cash-account checks stored with the preview summary; an absent or malformed entry is none. */
function readCashChecks(
  summary: Record<string, unknown> | null,
): MasRevenueCashAccountCheck[] {
  const stored = summary?.cashAccountChecks;
  return Array.isArray(stored) ? (stored as MasRevenueCashAccountCheck[]) : [];
}

function assertCompany(companyId: string): void {
  if (companyId !== MAS_REVENUE_COMPANY_ID) {
    throw new BadRequestException(
      `companyId must be "${MAS_REVENUE_COMPANY_ID}" for MAS Revenue Cash In`,
    );
  }
}

function assertTemplateVersion(version: number): void {
  if (version !== MAS_REVENUE_TEMPLATE_VERSION) {
    throw new BadRequestException(
      `templateVersion ${version} is not supported; this upload accepts version ${MAS_REVENUE_TEMPLATE_VERSION}`,
    );
  }
}

/**
 * Gives each receipt the currency of its verified D365 cash account. The cash ID comes
 * from the verified configuration. A receipt whose ID, status or currency is missing
 * keeps an empty currency; the submit blockers then name that cash account.
 */
export function resolveReceiptCurrencies(
  receipts: MasRevenueReceipt[],
  config: MasRevenueVerifiedConfig,
  checks: MasRevenueCashAccountCheck[],
): MasRevenueReceipt[] {
  const checkById = new Map(checks.map((check) => [check.id, check]));
  return receipts.map((receipt) => {
    const id =
      config.cashAccountIdsByDisplayName[
        normalizeSourceText(receipt.cashAccountDisplayName)
      ];
    const check = id ? checkById.get(id) : undefined;
    const currency =
      check && check.status === 'RCASH' && check.currency ? check.currency : '';
    return { ...receipt, currency };
  });
}

/** Hash of the normalized snapshot: the receipts in order, with their currencies and template version. */
function hashSnapshot(
  templateVersion: number,
  raws: MasRevenueStoredRaw[],
): string {
  return createHash('sha256')
    .update(JSON.stringify({ templateVersion, raws }))
    .digest('hex');
}

/** Totals grouped by each receipt's currency. Receipts without a resolved currency group under "UNRESOLVED". */
function totalsByCurrency(
  raws: MasRevenueStoredRaw[],
): Record<string, { value: string; vat: string; total: string }> {
  const sums = new Map<string, { value: number; vat: number; total: number }>();
  for (const raw of raws) {
    const key = raw.Currency || 'UNRESOLVED';
    const current = sums.get(key) ?? { value: 0, vat: 0, total: 0 };
    sums.set(key, {
      value: current.value + raw.ValueMinor,
      vat: current.vat + raw.VatMinor,
      total: current.total + raw.TotalMinor,
    });
  }
  return Object.fromEntries(
    [...sums.entries()].map(([currency, sum]) => [
      currency,
      {
        value: minorText(sum.value),
        vat: minorText(sum.vat),
        total: minorText(sum.total),
      },
    ]),
  );
}

function groupCounts(
  groups: EntryDynDataModel[],
): Array<{ journalBatchNumber: string; lineCount: number }> {
  const counts = new Map<string, number>();
  for (const line of groups) {
    counts.set(
      line.JournalBatchNumber,
      (counts.get(line.JournalBatchNumber) ?? 0) + 1,
    );
  }
  return [...counts.entries()].map(([journalBatchNumber, lineCount]) => ({
    journalBatchNumber,
    lineCount,
  }));
}

/** Minor units to a fixed two-decimal string. Money is never a binary float in the response. */
export function minorText(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function toIssueView(issue: MasRevenueRowIssue) {
  return {
    sourceSheet: issue.sourceSheet,
    sourceRow: issue.sourceRow,
    column: issue.column,
    originalValue: issue.originalValue,
    message: issue.message,
  };
}

function safeMessage(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : '';
  return (text || fallback).slice(0, 500);
}
