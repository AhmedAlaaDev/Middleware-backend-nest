import { YardOffsetAccountResolution } from './yard-invoice-account.resolver';
import {
  YardInvoiceAggregationIssue,
  YardInvoiceGroup,
} from './yard-invoice-aggregation';
import { microToString, parseDecimalToMicro } from './yard-invoice-decimal';
import {
  YardInvoiceLookupResult,
  YardInvoiceMetadata,
} from './yard-invoice-lookup.types';
import { YARD_INVOICE_BALANCE_TOLERANCE_MAJOR } from './yard-invoice.constants';

export type YardInvoiceGroupStatus = 'VALID' | 'BLOCKED';

export interface YardInvoiceGroupValidation {
  invoiceNumber: string;
  status: YardInvoiceGroupStatus;
  errors: string[];
  warnings: string[];
  /** Resolved D365 metadata, present only when the lookup found the invoice. */
  metadata: YardInvoiceMetadata | null;
  offsetAccount: YardOffsetAccountResolution | null;
  expectedOpenBalanceText: string | null;
  submittedTotalText: string;
}

export interface YardInvoiceValidationResult {
  groups: YardInvoiceGroupValidation[];
  /** True only when every group is VALID and there are no file-level issues. */
  canSubmit: boolean;
  blockedCount: number;
}

/**
 * Pure validation of consolidated invoices against D365 lookup and account
 * results. Nothing here is a fallback: a missing lookup or account blocks the
 * invoice, and customer, currency, dimensions, tag and account are never
 * filled from another row.
 */
export function validateYardInvoiceGroups(input: {
  groups: YardInvoiceGroup[];
  lookups: Map<string, YardInvoiceLookupResult>;
  offsetAccounts?: Map<string, YardOffsetAccountResolution>;
  /** Record-level issues from the workbook parser (either format). */
  templateIssues: { message: string }[];
  aggregationIssues: YardInvoiceAggregationIssue[];
}): YardInvoiceValidationResult {
  const fileLevelBlocked =
    input.templateIssues.length > 0 || input.aggregationIssues.length > 0;

  const groups = input.groups.map((group) =>
    validateGroup(
      group,
      input.lookups.get(group.invoiceNumber),
      input.offsetAccounts?.get(group.invoiceNumber),
    ),
  );

  const blockedCount = groups.filter((g) => g.status === 'BLOCKED').length;
  return {
    groups,
    canSubmit: !fileLevelBlocked && blockedCount === 0 && groups.length > 0,
    blockedCount,
  };
}

/**
 * Compares a workbook value with the D365 value. Customer accounts compare
 * trimmed. Dimensions and tags are D365 display strings padded with separators
 * and spaces, so they compare by their non-empty segments in order. A real
 * difference in any segment value still fails the comparison.
 */
export function sameDisplayValue(
  label: string,
  workbookValue: string,
  d365Value: string,
): boolean {
  if (label === 'customer account') {
    return workbookValue.trim() === d365Value.trim();
  }
  return canonicalSegments(workbookValue) === canonicalSegments(d365Value);
}

function canonicalSegments(value: string): string {
  return (
    value
      .split('|')
      // Spaces inside a segment are not significant: the workbook writes "MSC LINE"
      // where D365 stores "MSCLINE".
      .map((segment) => segment.replace(/\s+/g, ''))
      .filter((segment) => segment !== '')
      .join('|')
  );
}

function validateGroup(
  group: YardInvoiceGroup,
  lookup: YardInvoiceLookupResult | undefined,
  offsetAccount: YardOffsetAccountResolution | undefined,
): YardInvoiceGroupValidation {
  const errors = [...group.errors];
  const warnings: string[] = [];
  let metadata: YardInvoiceMetadata | null = null;
  let expectedOpenBalanceText: string | null = null;

  if (!lookup) {
    if (errors.length === 0) {
      errors.push('invoice was not looked up in D365');
    }
  } else if (lookup.status !== 'FOUND') {
    errors.push(`D365 lookup: ${lookup.status} - ${lookup.message}`);
  } else {
    metadata = lookup.metadata;

    if (metadata.currencyCode !== group.currencyCode) {
      errors.push(
        `currency mismatch: upload ${group.currencyCode}, invoice ${metadata.currencyCode}`,
      );
    }
    if (!metadata.customerAccount) {
      errors.push('customer account is missing on the invoice');
    }
    if (!metadata.defaultDimensionDisplayValue) {
      errors.push('default dimensions are missing on the invoice');
    }
    if (!metadata.financialTagDisplayValue) {
      errors.push('financial tag is missing on the invoice');
    }

    if (metadata.openBalance === null) {
      warnings.push(
        'open balance could not be read; balance is NOT validated for this invoice',
      );
    } else {
      expectedOpenBalanceText = microToString(metadata.openBalance);
      const tolerance = parseDecimalToMicro(
        String(YARD_INVOICE_BALANCE_TOLERANCE_MAJOR),
      );
      // A credit note total is negative; its eligible balance is the open credit.
      const total = group.isCreditNote
        ? -group.roundedTotal
        : group.roundedTotal;
      if (total > metadata.openBalance + tolerance) {
        errors.push(
          `total ${microToString(total)} exceeds the eligible balance ${expectedOpenBalanceText} (tolerance ${microToString(tolerance)})`,
        );
      }
    }
  }

  // Source-workbook values (Yards format) must match D365. The D365 value is
  // the one posted; any disagreement is shown and blocks the invoice.
  if (metadata) {
    const checks: [string, string[], string][] = [
      [
        'customer account',
        group.workbookCustomerAccounts,
        metadata.customerAccount,
      ],
      [
        'default dimensions',
        group.workbookDimensions,
        metadata.defaultDimensionDisplayValue,
      ],
      [
        'financial tag',
        group.workbookFinTags,
        metadata.financialTagDisplayValue,
      ],
    ];
    for (const [label, workbookValues, d365Value] of checks) {
      if (workbookValues.length === 0) continue;
      if (
        workbookValues.length === 1 &&
        sameDisplayValue(label, workbookValues[0], String(d365Value ?? ''))
      )
        continue;
      const difference =
        'workbook ' +
        label +
        ' (' +
        workbookValues.join(' | ') +
        ') differs from D365 (' +
        d365Value +
        ')';
      // The default dimension is posted from D365 (the customer's master
      // setting), so a workbook dimension that differs is shown as a warning.
      if (label === 'default dimensions' && workbookValues.length === 1) {
        warnings.push(difference + '; posting uses the D365 default dimension');
      } else {
        errors.push(difference + '; resolve the difference before submitting');
      }
    }
  }

  if (!offsetAccount) {
    errors.push('offset account (SAFE_BankAccount) was not validated in D365');
  } else if (offsetAccount.status !== 'OK') {
    errors.push(
      `offset account: ${offsetAccount.status} - ${offsetAccount.message}`,
    );
  }

  return {
    invoiceNumber: group.invoiceNumber,
    status: errors.length > 0 ? 'BLOCKED' : 'VALID',
    errors,
    warnings,
    metadata,
    offsetAccount: offsetAccount ?? null,
    expectedOpenBalanceText,
    submittedTotalText: microToString(group.roundedTotal),
  };
}
