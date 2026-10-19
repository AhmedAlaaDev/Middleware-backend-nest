import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

/** Main accounts treated as notes receivable by the cash journal rules. */
export const CASH_NOTES_RECEIVABLE_MAIN_ACCOUNTS = [
  '122201',
  '122202',
  '122203',
  '122204',
  '123510',
] as const;

/** Main accounts treated as settlement lines by the cash journal rules. */
export const CASH_SETTLEMENT_MAIN_ACCOUNTS = ['421103'] as const;

/**
 * Cash-In Collect journals post a zero-net 223404 debit / 512301 credit pair
 * next to the real petty-cash and vendor movement. Re-posting that pair on
 * Cash-Out Custody Settlement doubles the amount and splits D365 vouchers
 * because P-Freight opens a new voucher whenever the running balance hits 0.
 */
export const CASH_COLLECT_WASH_DEBIT_MAIN_ACCOUNT = '223404';
export const CASH_COLLECT_WASH_CREDIT_MAIN_ACCOUNT = '512301';

/**
 * Identifies a ledger source row affected by the 22420 dimension rule.
 *
 * Both the account and offset row are inspected because either side can
 * carry the relevant ledger account or FinTag. This preserves the existing
 * OR-based behavior of the cash processor.
 */
export function isCash22420LedgerDimensionLine(
  accountLine?: CashEntryRawDataModel,
  offsetLine?: CashEntryRawDataModel,
): boolean {
  const ledgerLine = [accountLine, offsetLine].find(
    (line) => line?.IsLedger || line?.ACCOUNTTYPE === 'Ledger',
  );
  if (!ledgerLine) return false;

  const has22420Tag = String(ledgerLine.FINTAGDISPLAYVALUE || '')
    .trim()
    .startsWith('22420');
  const has22420Account = String(ledgerLine.ACCOUNTDISPLAYVALUE || '')
    .trim()
    .startsWith('22420');

  return has22420Tag || has22420Account;
}

/** Returns whether a parsed cash line is a notes-receivable ledger line. */
export function isCashNotesReceivableLine(
  line: CashEntryRawDataModel,
  mainAccount?: string,
): boolean {
  return (
    line.ACCOUNTTYPE === 'Ledger' &&
    Boolean(mainAccount) &&
    CASH_NOTES_RECEIVABLE_MAIN_ACCOUNTS.includes(
      mainAccount as (typeof CASH_NOTES_RECEIVABLE_MAIN_ACCOUNTS)[number],
    )
  );
}

/** Returns whether a parsed cash line is a settlement ledger line. */
export function isCashSettlementLine(
  line: CashEntryRawDataModel,
  mainAccount?: string,
): boolean {
  return (
    line.ACCOUNTTYPE === 'Ledger' &&
    Boolean(mainAccount) &&
    CASH_SETTLEMENT_MAIN_ACCOUNTS.includes(
      mainAccount as (typeof CASH_SETTLEMENT_MAIN_ACCOUNTS)[number],
    )
  );
}

/**
 * Removes outbound placeholder invoice values such as `0` or `000`.
 * Cash-In invoice formatting intentionally remains a separate rule.
 */
export function sanitizeCashOutboundInvoice(invoice?: string): string {
  const trimmed = invoice?.trim() ?? '';
  if (!trimmed || /^0+$/.test(trimmed)) return '';
  return trimmed;
}

/**
 * Returns the first usable outbound invoice candidate.
 *
 * Each value is sanitized before selection so placeholder values such as
 * `0` do not prevent fallback to a real invoice or document number.
 */
export function resolveCashOutboundInvoice(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    const invoice = sanitizeCashOutboundInvoice(candidate ?? undefined);
    if (invoice) return invoice;
  }
  return '';
}
