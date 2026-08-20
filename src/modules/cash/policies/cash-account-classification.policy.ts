import { EntryAccountType } from '@/common/types';
import {
  CASH_NOTES_RECEIVABLE_MAIN_ACCOUNTS,
  CASH_SETTLEMENT_MAIN_ACCOUNTS,
} from '@/modules/cash/policies/cash-account.policy';

export interface CashLedgerMainAccountConfig {
  type: 'Ledger';
  mainAccount: string;
  description: string;
  currency: string;
}

/**
 * Main accounts Finance uses to represent working-capital application (WCApp)
 * cash movements. D365FO holds these as Ledger main accounts — they are not
 * registered `BankAccountTable` ids — so they must never be classified as
 * AccountType `Bank`, regardless of how the source row tags ACCOUNTTYPE.
 */
export const CASH_LEDGER_MAIN_ACCOUNT_CONFIG: Record<
  string,
  CashLedgerMainAccountConfig
> = {
  '125901': {
    type: 'Ledger',
    mainAccount: '125901',
    description: 'WCApp - USD',
    currency: 'USD',
  },
  '125902': {
    type: 'Ledger',
    mainAccount: '125902',
    description: 'WCApp - EUR',
    currency: 'EUR',
  },
};

/**
 * Main accounts that must never be posted as AccountType `Bank`. Includes
 * the configured Ledger main accounts above plus the existing settlement
 * (421103) and notes-receivable main accounts, as an extra pre-posting
 * safety net for accounts already known to be Ledger-only.
 */
const CASH_MAIN_ACCOUNTS_NEVER_BANK = new Set<string>([
  ...Object.keys(CASH_LEDGER_MAIN_ACCOUNT_CONFIG),
  ...CASH_SETTLEMENT_MAIN_ACCOUNTS,
  ...CASH_NOTES_RECEIVABLE_MAIN_ACCOUNTS,
]);

/**
 * Extracts the leading main-account token from a raw account display value.
 * Ledger rows encode the main account as the first pipe-delimited segment
 * (e.g. `125901|1301|...`); Bank/Petty-cash rows may store the main account
 * directly (e.g. `125901`).
 */
export function extractCashMainAccountToken(
  accountDisplayValue?: string,
): string {
  const trimmed = String(accountDisplayValue ?? '').trim();
  if (!trimmed) return '';
  return trimmed.split('|')[0]?.trim() ?? '';
}

export function getCashLedgerMainAccountConfig(
  mainAccount?: string,
): CashLedgerMainAccountConfig | undefined {
  if (!mainAccount) return undefined;
  return CASH_LEDGER_MAIN_ACCOUNT_CONFIG[mainAccount];
}

export function isKnownCashLedgerMainAccount(mainAccount?: string): boolean {
  return Boolean(mainAccount && CASH_LEDGER_MAIN_ACCOUNT_CONFIG[mainAccount]);
}

/** Returns whether a main account must never be posted as AccountType `Bank`. */
export function isKnownCashMainAccountNeverBank(mainAccount?: string): boolean {
  return Boolean(mainAccount && CASH_MAIN_ACCOUNTS_NEVER_BANK.has(mainAccount));
}

/**
 * Resolves the D365FO account type for a cash line, ensuring configured
 * Ledger main accounts (WCApp 125901/125902) are always classified as
 * `Ledger`, regardless of the source ACCOUNTTYPE value. Any other account
 * passes through unchanged.
 */
export function resolveCashAccountType(
  accountDisplayValue: string | undefined,
  sourceAccountType: EntryAccountType | undefined,
): EntryAccountType {
  const mainAccount = extractCashMainAccountToken(accountDisplayValue);
  const config = getCashLedgerMainAccountConfig(mainAccount);
  if (config) return config.type;
  return (sourceAccountType ?? '') as EntryAccountType;
}

/**
 * Returns a warning message when a configured Ledger main account is used
 * with a currency other than the one Finance configured for that account.
 * This is a signal only — callers decide whether to log or reject.
 */
export function validateCashLedgerAccountCurrency(
  accountDisplayValue: string | undefined,
  currencyCode: string | undefined,
): string | null {
  const mainAccount = extractCashMainAccountToken(accountDisplayValue);
  const config = getCashLedgerMainAccountConfig(mainAccount);
  if (!config) return null;

  const currency = String(currencyCode ?? '')
    .trim()
    .toUpperCase();
  if (!currency || currency === config.currency) return null;

  return `Account ${config.mainAccount} is configured for ${config.currency} but transaction currency is ${currency}.`;
}

/**
 * Pre-posting guard: a main account known to be Ledger-only must never be
 * resolved as AccountType `Bank`. Returns an error message when that
 * invariant is violated, so the D365FO `BankAccountTable` posting failure is
 * caught here instead of by D365FO.
 */
export function findCashBankMisclassificationError(
  resolvedAccountType: string | undefined,
  accountDisplayValue: string | undefined,
): string | null {
  if (resolvedAccountType !== 'Bank') return null;

  const mainAccount = extractCashMainAccountToken(accountDisplayValue);
  if (!isKnownCashMainAccountNeverBank(mainAccount)) return null;

  return `Main account ${mainAccount} was incorrectly resolved as a Bank account.`;
}
