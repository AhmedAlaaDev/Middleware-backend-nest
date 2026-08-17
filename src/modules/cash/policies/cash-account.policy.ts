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

