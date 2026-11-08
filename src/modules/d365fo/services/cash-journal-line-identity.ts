/**
 * Identity of Cash-Out journal lines (Custody Settlement).
 *
 * D365 renumbers journal lines in insertion order (no X++ class assigns
 * LineNum) and requests are sent in a different order than they are planned,
 * so a PLANNED line number is never proof of identity. A line is identified
 * by the composite below, which only uses fields verified on the
 * VendorPaymentJournalLines entity:
 *
 *   PaymentId (source UniqueId) + AccountType + account + currency +
 *   DebitAmount + CreditAmount
 *
 * Several lines of one UniqueId can be identical in all of these (repeated
 * amounts). They are therefore matched as a MULTISET: when the number of
 * identical lines in D365 differs from the number planned, the match cannot
 * attribute lines individually and the caller must fail closed.
 *
 * All amounts are integer minor units (cents).
 */

export interface PlannedJournalLine {
  /** Line number planned by the middleware (NOT a D365 identity). */
  lineNumber: number;
  /** Source UniqueId (PAYMENTID). */
  paymentId: string;
  /** Request account type (Vendor, Ledger, RCash, Bank ...). */
  accountType: string;
  /** Request AccountNum: vendor/bank/petty-cash id or full ledger string. */
  account: string;
  currency: string;
  debitCents: number;
  creditCents: number;
  /** True when the request line carries no offset account. */
  offsetless: boolean;
}

export interface ActualJournalLine {
  /** D365 LineNumber (authoritative for later OData calls). */
  lineNumber: number;
  paymentId: string;
  accountType: string;
  account: string;
  currency: string;
  debitCents: number;
  creditCents: number;
  voucher: string;
}

/** Raw VendorPaymentJournalLines row (only fields verified in D365). */
export interface VendorPaymentJournalLineRow {
  LineNumber?: number | string;
  PaymentId?: string | null;
  AccountType?: string | null;
  AccountDisplayValue?: string | null;
  CurrencyCode?: string | null;
  DebitAmount?: number | string | null;
  CreditAmount?: number | string | null;
  Voucher?: string | null;
}

/**
 * Decimal money to integer cents, rounding half away from zero on the decimal
 * representation. Source amounts may carry 4 decimals while D365 stores 2, so
 * the rounding must match D365's decimal rounding rather than float noise.
 */
export function decimalToCents(amount: unknown): number {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return 0;
  const negative = value < 0;
  const [whole, fraction = ''] = Math.abs(value).toFixed(6).split('.');
  let cents = Number(whole) * 100 + Number(fraction.slice(0, 2));
  if (Number(fraction.charAt(2)) >= 5) cents += 1;
  return negative ? -cents : cents;
}

/** Safe text of an unknown value (strings and numbers only). */
const asText = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'bigint'
      ? String(value)
      : '';

export function normalizeJournalAccountType(value: unknown): string {
  const type = asText(value)
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (type === 'vendor' || type === 'vend') return 'vend';
  if (type === 'pettycash' || type === 'rcash') return 'rcash';
  return type;
}

const normalizeText = (value: unknown): string =>
  asText(value).trim().replace(/\s+/g, ' ').toLowerCase();

/** Ledger accounts are identified by their main account (first segment). */
export function normalizeJournalAccount(
  accountType: unknown,
  account: unknown,
): string {
  if (normalizeJournalAccountType(accountType) === 'ledger') {
    return normalizeText(asText(account).split('|')[0]);
  }
  return normalizeText(account);
}

/**
 * Ledger dimension string normalised for comparison: segments trimmed and
 * lower-cased (D365 returns canonical casing, e.g. "Export" for "EXPORT"),
 * trailing empty segments removed.
 */
export function normalizeLedgerDimensions(account: unknown): string {
  const segments = asText(account)
    .split('|')
    .map((segment) => normalizeText(segment));
  while (segments.length > 1 && segments[segments.length - 1] === '') {
    segments.pop();
  }
  return segments.join('|');
}

export function journalLineIdentityKey(line: {
  paymentId: string;
  accountType: string;
  account: string;
  currency: string;
  debitCents: number;
  creditCents: number;
}): string {
  return [
    normalizeText(line.paymentId),
    normalizeJournalAccountType(line.accountType),
    normalizeJournalAccount(line.accountType, line.account),
    normalizeText(line.currency),
    line.debitCents,
    line.creditCents,
  ].join('\u001f');
}

/** The request-body fields that make up a planned line (all optional). */
export interface JournalRequestBody {
  PAYMENTID?: unknown;
  accountTypeStr?: unknown;
  AccountNum?: unknown;
  currency?: unknown;
  debitAmount?: unknown;
  creditAmount?: unknown;
  OffsetAccountTypeStr?: unknown;
}

/** A cash-out request line as the identity used to find it in D365. */
export function toPlannedJournalLine(
  lineNumber: number,
  body: JournalRequestBody,
): PlannedJournalLine {
  return {
    lineNumber,
    paymentId: asText(body.PAYMENTID).trim(),
    accountType: asText(body.accountTypeStr).trim(),
    account: asText(body.AccountNum).trim(),
    currency: asText(body.currency).trim(),
    debitCents: decimalToCents(body.debitAmount),
    creditCents: decimalToCents(body.creditAmount),
    offsetless: !asText(body.OffsetAccountTypeStr).trim(),
  };
}

export function toActualJournalLine(
  row: VendorPaymentJournalLineRow,
): ActualJournalLine {
  return {
    lineNumber: Number(row.LineNumber ?? 0),
    paymentId: String(row.PaymentId ?? '').trim(),
    accountType: String(row.AccountType ?? '').trim(),
    account: String(row.AccountDisplayValue ?? '').trim(),
    currency: String(row.CurrencyCode ?? '').trim(),
    debitCents: decimalToCents(row.DebitAmount),
    creditCents: decimalToCents(row.CreditAmount),
    voucher: String(row.Voucher ?? '').trim(),
  };
}

export type JournalIntegrityCode =
  | 'JOURNAL_LINES_MISSING'
  | 'JOURNAL_LINE_MISMATCH'
  | 'JOURNAL_IMBALANCE'
  | 'JOURNAL_RECOVERY_AMBIGUOUS';

export interface JournalReconciliation {
  /** Planned line numbers that already exist in D365 (matched by identity). */
  existingPlannedLineNumbers: Set<number>;
  /**
   * Identities whose count in D365 differs from the plan in a way that cannot
   * be attributed to individual lines (0 < actual < planned for repeated
   * lines, or actual > planned). Recovery must stop for their UniqueIds.
   */
  ambiguousIdentities: Array<{
    paymentId: string;
    planned: number;
    actual: number;
    plannedLineNumbers: number[];
  }>;
}

const groupByIdentity = <
  T extends Parameters<typeof journalLineIdentityKey>[0],
>(
  lines: readonly T[],
): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const line of lines) {
    const key = journalLineIdentityKey(line);
    const bucket = map.get(key) ?? [];
    bucket.push(line);
    map.set(key, bucket);
  }
  return map;
};

/**
 * Decide which planned lines already exist in D365 (retry / restart
 * recovery). Only actual lines carrying a planned PaymentId are considered:
 * other lines of the journal are not part of this plan.
 */
export function reconcileExistingJournalLines(
  planned: readonly PlannedJournalLine[],
  actual: readonly ActualJournalLine[],
): JournalReconciliation {
  const plannedIds = new Set(planned.map((l) => normalizeText(l.paymentId)));
  const relevantActual = actual.filter((l) =>
    plannedIds.has(normalizeText(l.paymentId)),
  );
  const plannedByKey = groupByIdentity(planned);
  const actualByKey = groupByIdentity(relevantActual);

  const existing = new Set<number>();
  const ambiguous: JournalReconciliation['ambiguousIdentities'] = [];

  for (const [key, plannedLines] of plannedByKey) {
    const actualCount = actualByKey.get(key)?.length ?? 0;
    if (actualCount === 0) continue;
    if (actualCount === plannedLines.length) {
      plannedLines.forEach((l) => existing.add(l.lineNumber));
      continue;
    }
    ambiguous.push({
      paymentId: plannedLines[0].paymentId,
      planned: plannedLines.length,
      actual: actualCount,
      plannedLineNumbers: plannedLines.map((l) => l.lineNumber),
    });
  }
  // Actual lines of a planned UniqueId that match NO planned identity: they
  // are not this plan's lines; the post-write verification reports them.
  return {
    existingPlannedLineNumbers: existing,
    ambiguousIdentities: ambiguous,
  };
}

/** Planned lines of a request that are all present after a timeout. */
export function classifyTimeoutRecovery(
  requestLines: readonly PlannedJournalLine[],
  baselineCounts: ReadonlyMap<string, number>,
  actual: readonly ActualJournalLine[],
): 'COMMITTED' | 'NOT_COMMITTED' | 'AMBIGUOUS' {
  const requested = groupByIdentity(requestLines);
  const actualCounts = new Map<string, number>();
  for (const [key, bucket] of groupByIdentity(actual)) {
    actualCounts.set(key, bucket.length);
  }
  let committed = 0;
  let notCommitted = 0;
  for (const [key, lines] of requested) {
    const before = baselineCounts.get(key) ?? 0;
    const now = actualCounts.get(key) ?? 0;
    if (now === before + lines.length) committed++;
    else if (now === before) notCommitted++;
    else return 'AMBIGUOUS';
  }
  if (committed > 0 && notCommitted === 0) return 'COMMITTED';
  if (notCommitted > 0 && committed === 0) return 'NOT_COMMITTED';
  return 'AMBIGUOUS';
}

/** Count of every identity currently in D365 (recovery baseline). */
export function countJournalIdentities(
  actual: readonly ActualJournalLine[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [key, bucket] of groupByIdentity(actual)) {
    counts.set(key, bucket.length);
  }
  return counts;
}

export function plannedIdentityCounts(
  planned: readonly PlannedJournalLine[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [key, bucket] of groupByIdentity(planned)) {
    counts.set(key, bucket.length);
  }
  return counts;
}

export type LedgerDimensionMatch = 'EXACT' | 'DROPPED' | 'DIFFERENT';

/**
 * D365 keeps only the dimensions its account structure allows for a main
 * account and stores the rest EMPTY (verified: main account 124101 keeps all
 * 13, 223404 and 223712 keep exactly 4). The middleware sends every
 * dimension, so a correct line may come back with fewer. An actual dimension
 * string is therefore consistent with the plan when every non-empty actual
 * segment equals the planned one: values may be DROPPED, never CHANGED or
 * ADDED.
 */
export function compareLedgerDimensions(
  expected: string,
  actual: string,
): LedgerDimensionMatch {
  const expectedSegments = normalizeLedgerDimensions(expected).split('|');
  const actualSegments = normalizeLedgerDimensions(actual).split('|');
  if (expectedSegments.join('|') === actualSegments.join('|')) return 'EXACT';
  const length = Math.max(expectedSegments.length, actualSegments.length);
  for (let i = 0; i < length; i++) {
    const actualValue = actualSegments[i] ?? '';
    if (actualValue !== '' && actualValue !== (expectedSegments[i] ?? '')) {
      return 'DIFFERENT';
    }
  }
  return 'DROPPED';
}
