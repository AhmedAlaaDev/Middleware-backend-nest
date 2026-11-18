import { createHash, randomUUID } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';

import {
  YardInvoiceAccountResolver,
  YardOffsetAccountResolution,
  offsetRequestKey,
} from './yard-invoice-account.resolver';
import {
  aggregateYardInvoiceRecords,
  YardInvoiceAggregationIssue,
  YardInvoiceGroup,
} from './yard-invoice-aggregation';
import { microToString, Micro } from './yard-invoice-decimal';
import { YardInvoiceEnrichmentService } from './yard-invoice-enrichment.service';
import { YardInvoiceLookupResult } from './yard-invoice-lookup.types';
import { YardPostingAdapterInput } from './yard-invoice-posting-adapter';
import { YardRecordIssue, YardUploadFormat } from './yard-invoice-record';
import {
  validateYardInvoiceGroups,
  YardInvoiceGroupValidation,
  YardInvoiceValidationResult,
} from './yard-invoice-validation';
import { parseYardWorkbook } from './yard-invoice-workbook';
import { YARD_INVOICE_FEATURE_FLAG } from './yard-invoice.constants';

import type { YardsSheetSummary } from './yard-invoice-source-workbook.parser';

/** Everything a review produces. Submit re-runs this on the server. */
export interface YardInvoiceReview {
  correlationId: string;
  company: string;
  fileName: string;
  format: YardUploadFormat;
  formatLabel: string;
  sheets: YardsSheetSummary[];
  recordCount: number;
  issues: YardRecordIssue[];
  aggregationIssues: YardInvoiceAggregationIssue[];
  groups: YardInvoiceGroup[];
  lookups: Map<string, YardInvoiceLookupResult>;
  /** Offset account result per invoice number (only for invoices that were looked up). */
  offsetAccounts: Map<string, YardOffsetAccountResolution>;
  validation: YardInvoiceValidationResult;
  payloadHash: string;
}

export interface YardInvoiceSummary {
  format: YardUploadFormat;
  formatLabel: string;
  fileName: string;
  companyId: string;
  sheets: YardsSheetSummary[];
  recordCount: number;
  distinctInvoiceCount: number;
  blockedInvoiceCount: number;
  issueCount: number;
  aggregationIssueCount: number;
  creditNoteInvoiceCount: number;
  discrepancyCount: number;
  lookupFailedCount: number;
  currencyTotals: {
    currencyCode: string;
    invoiceCount: number;
    rawTotal: string;
    roundedTotal: string;
    roundingChange: string;
  }[];
  offsetAccountCounts: { status: string; count: number }[];
  issues: YardRecordIssue[];
  aggregationIssues: YardInvoiceAggregationIssue[];
  canSubmit: boolean;
  submitBlockedReason: string | null;
  payloadHash: string;
  correlationId: string;
}

/** One reviewed invoice, as stored for paged display. */
export interface YardInvoiceReviewLine {
  invoiceNumber: string;
  status: 'VALID' | 'BLOCKED';
  creditNote: boolean;
  sourceRefs: string[];
  paymentSerials: string[];
  currencyCode: string;
  paymentType: string;
  paymentDate: string;
  safeBankAccount: string;
  paymentReference: string;
  rawTotal: string;
  roundedTotal: string;
  roundingChange: string;
  roundingVariance: string;
  workbook: {
    customerAccounts: string[];
    dimensions: string[];
    financialTags: string[];
  };
  d365: {
    customerAccount: string | null;
    defaultDimensionDisplayValue: string | null;
    financialTagDisplayValue: string | null;
    voucher: string | null;
    expectedOpenBalance: string | null;
  };
  offsetAccount: {
    status: string;
    accountType: string | null;
    message: string;
  } | null;
  errors: string[];
  warnings: string[];
}

export function isYardInvoiceUploadEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = String(env[YARD_INVOICE_FEATURE_FLAG] ?? '')
    .trim()
    .toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

@Injectable()
export class YardInvoicePreviewService {
  private readonly logger = new Logger(YardInvoicePreviewService.name);

  constructor(
    private readonly enrichment: YardInvoiceEnrichmentService,
    private readonly accounts: YardInvoiceAccountResolver,
  ) {}

  /**
   * Read-only review: parse the workbook (either format), consolidate by
   * invoice, look up each invoice and its offset account in D365 (batched),
   * compare workbook values with D365, and validate. Nothing is posted.
   */
  public async review(input: {
    fileBuffer: Buffer<ArrayBufferLike>;
    fileName: string;
    companyId: string;
  }): Promise<YardInvoiceReview> {
    const correlationId = randomUUID();
    const company = String(input.companyId ?? '').trim();
    const parsed = await parseYardWorkbook(input.fileBuffer);
    const aggregation = aggregateYardInvoiceRecords(parsed.records);

    const eligible = aggregation.groups.filter(
      (group) => group.errors.length === 0,
    );
    const lookups = await this.enrichment.resolveInvoices(
      company,
      eligible.map((group) => group.invoiceNumber),
    );

    const found = eligible.filter(
      (group) => lookups.get(group.invoiceNumber)?.status === 'FOUND',
    );
    const byKey = await this.accounts.resolveMany(
      company,
      found.map((group) => ({
        paymentType: group.paymentType,
        safeBankAccount: group.safeBankAccount,
        paymentDate: group.paymentDate,
        currencyCode: group.currencyCode,
      })),
    );
    const offsetAccounts = new Map<string, YardOffsetAccountResolution>();
    for (const group of found) {
      const resolution = byKey.get(offsetRequestKey(group));
      if (resolution) offsetAccounts.set(group.invoiceNumber, resolution);
    }

    const validation = validateYardInvoiceGroups({
      groups: aggregation.groups,
      lookups,
      offsetAccounts,
      templateIssues: parsed.issues,
      aggregationIssues: aggregation.issues,
    });

    this.logger.log(
      JSON.stringify({
        event: 'yard_invoice_review',
        correlationId,
        company,
        format: parsed.format,
        recordCount: parsed.records.length,
        issueCount: parsed.issues.length,
        invoiceCount: aggregation.groups.length,
        blockedInvoiceCount: validation.blockedCount,
        canSubmit: validation.canSubmit,
      }),
    );

    return {
      correlationId,
      company,
      fileName: input.fileName,
      format: parsed.format,
      formatLabel: parsed.formatLabel,
      sheets: parsed.sheets,
      recordCount: parsed.records.length,
      issues: parsed.issues,
      aggregationIssues: aggregation.issues,
      groups: aggregation.groups,
      lookups,
      offsetAccounts,
      validation,
      payloadHash: hashPayload(company, aggregation.groups, validation.groups),
    };
  }

  /** Inputs for the posting adapter. Only valid when the review can submit. */
  public toPostingInputs(review: YardInvoiceReview): YardPostingAdapterInput[] {
    if (!review.validation.canSubmit) {
      throw new Error('review is not submittable');
    }
    const groupsByInvoice = new Map(
      review.groups.map((g) => [g.invoiceNumber, g]),
    );
    return review.validation.groups.map((check) => {
      const group = groupsByInvoice.get(check.invoiceNumber);
      if (!group || !check.metadata || !check.offsetAccount) {
        throw new Error(
          `invoice ${check.invoiceNumber} is missing review data`,
        );
      }
      return {
        group,
        metadata: check.metadata,
        offsetAccount: check.offsetAccount,
      };
    });
  }

  /** Summary for the job record and the review screen. Bounded size. */
  public toSummary(review: YardInvoiceReview): YardInvoiceSummary {
    const checks = review.validation.groups;
    const totals = new Map<
      string,
      { invoiceCount: number; raw: bigint; rounded: bigint; change: bigint }
    >();
    for (const group of review.groups) {
      const current = totals.get(group.currencyCode) ?? {
        invoiceCount: 0,
        raw: 0n,
        rounded: 0n,
        change: 0n,
      };
      current.invoiceCount += 1;
      current.raw += group.rawTotal;
      current.rounded += group.roundedTotal;
      current.change += group.roundingChange;
      totals.set(group.currencyCode, current);
    }
    const accountCounts = new Map<string, number>();
    for (const resolution of review.offsetAccounts.values()) {
      accountCounts.set(
        resolution.status,
        (accountCounts.get(resolution.status) ?? 0) + 1,
      );
    }
    const discrepancyCount = checks.filter((c) =>
      c.errors.some((e) => e.startsWith('workbook ')),
    ).length;
    const creditNotes = review.groups.filter((g) => g.isCreditNote).length;
    const canSubmit = review.validation.canSubmit;
    return {
      format: review.format,
      formatLabel: review.formatLabel,
      fileName: review.fileName,
      companyId: review.company,
      sheets: review.sheets,
      recordCount: review.recordCount,
      distinctInvoiceCount: review.groups.length,
      blockedInvoiceCount: review.validation.blockedCount,
      issueCount: review.issues.length,
      aggregationIssueCount: review.aggregationIssues.length,
      creditNoteInvoiceCount: creditNotes,
      discrepancyCount,
      lookupFailedCount: [...review.lookups.values()].filter(
        (l) => l.status === 'LOOKUP_FAILED',
      ).length,
      currencyTotals: [...totals.entries()].map(([currencyCode, t]) => ({
        currencyCode,
        invoiceCount: t.invoiceCount,
        rawTotal: microToString(t.raw),
        roundedTotal: microToString(t.rounded),
        roundingChange: microToString(t.change),
      })),
      offsetAccountCounts: [...accountCounts.entries()].map(
        ([status, count]) => ({ status, count }),
      ),
      issues: review.issues.slice(0, 200),
      aggregationIssues: review.aggregationIssues.slice(0, 200),
      canSubmit,
      submitBlockedReason: canSubmit
        ? null
        : 'Fix the blocked invoices or file issues and upload again.',
      payloadHash: review.payloadHash,
      correlationId: review.correlationId,
    };
  }

  /** One stored line per invoice, for paged display and audit. */
  public toLines(review: YardInvoiceReview): YardInvoiceReviewLine[] {
    const checks = new Map(
      review.validation.groups.map((c) => [c.invoiceNumber, c]),
    );
    return review.groups.map((group) => {
      const check: YardInvoiceGroupValidation | undefined = checks.get(
        group.invoiceNumber,
      );
      const metadata = check?.metadata ?? null;
      return {
        invoiceNumber: group.invoiceNumber,
        status: check?.status ?? 'BLOCKED',
        creditNote: group.isCreditNote,
        sourceRefs: group.sourceRefs,
        paymentSerials: group.paymentSerials,
        currencyCode: group.currencyCode,
        paymentType: group.paymentType,
        paymentDate: group.paymentDate,
        safeBankAccount: group.safeBankAccount,
        paymentReference: group.paymentReference,
        rawTotal: group.rawTotalText,
        roundedTotal: group.roundedTotalText,
        roundingChange: group.roundingChangeText,
        roundingVariance: group.roundingVarianceText,
        workbook: {
          customerAccounts: group.workbookCustomerAccounts,
          dimensions: group.workbookDimensions,
          financialTags: group.workbookFinTags,
        },
        d365: {
          customerAccount: metadata?.customerAccount ?? null,
          defaultDimensionDisplayValue:
            metadata?.defaultDimensionDisplayValue ?? null,
          financialTagDisplayValue: metadata?.financialTagDisplayValue ?? null,
          voucher: metadata?.voucher ?? null,
          expectedOpenBalance: check?.expectedOpenBalanceText ?? null,
        },
        offsetAccount: check?.offsetAccount
          ? {
              status: check.offsetAccount.status,
              accountType: check.offsetAccount.accountType,
              message: check.offsetAccount.message,
            }
          : null,
        errors: check?.errors ?? ['invoice was not validated'],
        warnings: check?.warnings ?? [],
      };
    });
  }
}

/**
 * Stable hash of everything a posting depends on: the consolidated groups,
 * their source rows and the D365 values resolved for them. A change in D365
 * or in the workbook changes the hash, so the reviewer must review again.
 */
export function hashPayload(
  company: string,
  groups: YardInvoiceGroup[],
  checks: YardInvoiceGroupValidation[] = [],
): string {
  const checkByInvoice = new Map(checks.map((c) => [c.invoiceNumber, c]));
  const canonical = [...groups]
    .sort((a, b) => (a.invoiceNumber < b.invoiceNumber ? -1 : 1))
    .map((g) => {
      const check = checkByInvoice.get(g.invoiceNumber);
      const metadata = check?.metadata ?? null;
      const account = check?.offsetAccount ?? null;
      return {
        invoiceNumber: g.invoiceNumber,
        currencyCode: g.currencyCode,
        paymentType: g.paymentType,
        safeBankAccount: g.safeBankAccount,
        paymentDate: g.paymentDate,
        paymentReference: g.paymentReference,
        sources: g.sources.map(
          (s) =>
            `${s.sourceSheet}!${s.sourceRow}:${s.amountText}:${s.paymentSerial ?? ''}`,
        ),
        roundedTotal: g.roundedTotalText,
        customerAccount: metadata?.customerAccount ?? null,
        defaultDimensionDisplayValue:
          metadata?.defaultDimensionDisplayValue ?? null,
        financialTagDisplayValue: metadata?.financialTagDisplayValue ?? null,
        voucher: metadata?.voucher ?? null,
        offsetAccountType: account?.accountType ?? null,
        offsetAccountStatus: account?.status ?? null,
      };
    });
  return createHash('sha256')
    .update(JSON.stringify({ company, groups: canonical }))
    .digest('hex');
}

export type { Micro };
