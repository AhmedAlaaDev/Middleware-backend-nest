import type { MasJournalLine, MasRevenueReceipt } from './mas-revenue.types';

/**
 * Pure helpers for a template version 2 line. Which side holds the petty cash, and
 * whether cash goes in or out, is read from the row. It is never taken from a label.
 */

/** The D365 petty-cash (RCash) ID on the row: the account on whichever side is RCash. */
export function cashAccountIdOf(line: MasJournalLine): string {
  return line.accountType === 'RCash' ? line.account : line.offsetAccount;
}

/** The ledger composite on the row: the account on whichever side is Ledger. */
export function ledgerAccountOf(line: MasJournalLine): string {
  return line.accountType === 'Ledger' ? line.account : line.offsetAccount;
}

export type MasCashEffect = 'in' | 'out';

/**
 * Whether the line puts cash in or takes it out.
 *
 * The amount sits on the line\u2019s account side. When that side is the cash account, a
 * debit puts cash in and a credit takes it out. When the cash account is the offset,
 * the offset side is the opposite one: a debit on the ledger credits cash (out) and a
 * credit on the ledger debits cash (in). The finance examples follow this: a revenue
 * invoice debits RCash; an expense debits the ledger against an RCash offset; the
 * reversal of that expense credits the ledger.
 */
export function cashEffectOf(line: MasJournalLine): MasCashEffect {
  const cashIsAccount = line.accountType === 'RCash';
  const debit = line.side === 'debit';
  if (cashIsAccount) return debit ? 'in' : 'out';
  return debit ? 'out' : 'in';
}

export function isJournalReceipt(
  receipt: Pick<MasRevenueReceipt, 'journalLine'>,
): receipt is { journalLine: MasJournalLine } {
  return receipt.journalLine !== undefined;
}
