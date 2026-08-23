import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

export interface CustodyIssueLinePlan {
  readonly line: CashEntryRawDataModel;
}

/**
 * Owns Cash-Out Custody Issue preparation.
 *
 * Custody Issue has no settlement or withholding transformation: every input
 * row is posted as one output row. Common journal, dimensions, currency, and
 * request-field mapping remains in the shared source-line builder.
 */
export function prepareCustodyIssueLines(
  lines: readonly CashEntryRawDataModel[],
): CustodyIssueLinePlan[] {
  return lines.map((line) => ({ line }));
}
