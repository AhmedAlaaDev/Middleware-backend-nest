import { decimalToCents } from '@/modules/d365fo/services/cash-journal-line-identity';

/**
 * One GL journal line as read back from D365 (LedgerJournalLines).
 *
 * Field names were verified on 2026-11-24 against the MAS sandbox entity: the
 * amounts are DebitAmount and CreditAmount (not AmountCurDebit/AmountCurCredit),
 * and the offset composite carries its dimensions after the main account, followed
 * by trailing empty segments (e.g. "224608|2401|024|002|005|||").
 */
export interface MasRevenueGlLineRow {
  LineNumber?: number | string | null;
  AccountType?: string | null;
  AccountDisplayValue?: string | null;
  CurrencyCode?: string | null;
  DebitAmount?: number | string | null;
  CreditAmount?: number | string | null;
  OffsetAccountType?: string | null;
  OffsetAccountDisplayValue?: string | null;
  Voucher?: string | null;
}

/** The expected content of one planned line. */
export interface MasRevenuePlannedGlLine {
  account: string;
  currency: string;
  debitCents: number;
  creditCents: number;
  offsetAccount: string;
}

/**
 * Canonical form of an account composite: each segment trimmed, trailing empty
 * segments dropped. D365 returns the dimensions with trailing empty segments, and
 * the planned composite does not have them; those are the same account.
 */
export function canonicalComposite(value: unknown): string {
  if (typeof value !== 'string') return '';
  const segments = value.split('|').map((segment) => segment.trim());
  while (segments.length > 0 && segments[segments.length - 1] === '') {
    segments.pop();
  }
  return segments.join('|');
}

/** Separator that cannot occur in an account composite, so keys cannot collide. */
const KEY_SEPARATOR = '\u001f';

function rowKey(line: MasRevenuePlannedGlLine): string {
  return [
    canonicalComposite(line.account),
    line.currency.trim().toUpperCase(),
    line.debitCents,
    line.creditCents,
    canonicalComposite(line.offsetAccount),
  ].join(KEY_SEPARATOR);
}

function actualKey(row: MasRevenueGlLineRow): string {
  return [
    canonicalComposite(row.AccountDisplayValue),
    String(row.CurrencyCode ?? '')
      .trim()
      .toUpperCase(),
    decimalToCents(row.DebitAmount ?? 0),
    decimalToCents(row.CreditAmount ?? 0),
    canonicalComposite(row.OffsetAccountDisplayValue),
  ].join(KEY_SEPARATOR);
}

function describeKey(key: string): string {
  return key.split(KEY_SEPARATOR).join(' / ');
}

/**
 * Compares the complete posted journal content with the planned lines as
 * multisets: same accounts, currency, amounts and offset accounts, with the same
 * number of lines. Line numbers are not compared, because D365 renumbers lines.
 * Returns the discrepancies; an empty list means the content matches.
 */
export function verifyMasRevenueReadback(
  planned: readonly MasRevenuePlannedGlLine[],
  actual: readonly MasRevenueGlLineRow[],
): string[] {
  const problems: string[] = [];
  if (actual.length !== planned.length) {
    problems.push(
      `expected ${planned.length} line(s) in the journal, found ${actual.length}`,
    );
  }

  const remaining = new Map<string, number>();
  for (const line of planned) {
    const key = rowKey(line);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const unexpected: string[] = [];
  for (const row of actual) {
    const key = actualKey(row);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
    } else {
      unexpected.push(key);
    }
  }

  for (const [key, count] of remaining) {
    if (count > 0) {
      problems.push(
        `missing line: ${describeKey(key)}${count > 1 ? ` (x${count})` : ''}`,
      );
    }
  }
  for (const key of unexpected) {
    problems.push(`unexpected line: ${describeKey(key)}`);
  }
  return problems;
}
