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
  'WCA-US': {
    type: 'Ledger',
    mainAccount: '125901',
    description: 'WCApp - USD',
    currency: 'USD',
  },
  'WCA-EUR': {
    type: 'Ledger',
    mainAccount: '125902',
    description: 'WCApp - EUR',
    currency: 'EUR',
  },
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

export const FORCED_LEDGER_ACCOUNTS = new Set<string>([
  'WCA-US',
  'WCA-EUR',
  '125901',
  '125902',
  ...CASH_SETTLEMENT_MAIN_ACCOUNTS,
]);

/**
 * Normalizes account display values (uppercase, trimmed).
 */
export function normalizeAccountValue(value?: string | null): string {
  return (value ?? '').trim().toUpperCase();
}

/**
 * Main accounts that must never be posted as AccountType `Bank`. Includes
 * WCA-US, WCA-EUR, configured Ledger main accounts, and settlement (421103) main accounts.
 */
const CASH_MAIN_ACCOUNTS_NEVER_BANK = FORCED_LEDGER_ACCOUNTS;

/**
 * Extracts the leading main-account token from a raw account display value.
 */
export function extractCashMainAccountToken(
  accountDisplayValue?: string,
): string {
  const normalized = normalizeAccountValue(accountDisplayValue);
  if (!normalized) return '';
  if (normalized.startsWith('WCA-US')) return 'WCA-US';
  if (normalized.startsWith('WCA-EUR')) return 'WCA-EUR';
  return normalized.split('|')[0]?.trim() ?? '';
}

export function getCashLedgerMainAccountConfig(
  accountDisplayValue?: string,
): CashLedgerMainAccountConfig | undefined {
  if (!accountDisplayValue) return undefined;
  const normalized = normalizeAccountValue(accountDisplayValue);
  if (normalized.startsWith('WCA-US')) return CASH_LEDGER_MAIN_ACCOUNT_CONFIG['WCA-US'];
  if (normalized.startsWith('WCA-EUR')) return CASH_LEDGER_MAIN_ACCOUNT_CONFIG['WCA-EUR'];
  const mainAccount = extractCashMainAccountToken(accountDisplayValue);
  return CASH_LEDGER_MAIN_ACCOUNT_CONFIG[mainAccount];
}

export function resolveWcaMainAccount(accountDisplayValue?: string): string {
  const config = getCashLedgerMainAccountConfig(accountDisplayValue);
  if (config) return config.mainAccount;
  return accountDisplayValue ?? '';
}

export function isKnownCashLedgerMainAccount(accountDisplayValue?: string): boolean {
  return Boolean(getCashLedgerMainAccountConfig(accountDisplayValue));
}

/** Returns whether a main account must never be posted as AccountType `Bank`. */
export function isKnownCashMainAccountNeverBank(accountDisplayValue?: string): boolean {
  const normalized = normalizeAccountValue(accountDisplayValue);
  if (!normalized) return false;
  if (normalized.startsWith('WCA-US') || normalized.startsWith('WCA-EUR')) return true;
  const token = extractCashMainAccountToken(accountDisplayValue);
  return CASH_MAIN_ACCOUNTS_NEVER_BANK.has(token);
}

/**
 * Resolves the D365FO account type for a cash line, ensuring configured
 * Ledger main accounts (WCA-US / WCA-EUR / WCApp 125901 / 125902) are always
 * classified as `Ledger`, regardless of the source ACCOUNTTYPE value.
 */
export function resolveCashAccountType(
  accountDisplayValue: string | undefined,
  sourceAccountType: EntryAccountType | undefined,
): EntryAccountType {
  const config = getCashLedgerMainAccountConfig(accountDisplayValue);
  if (config) return config.type;
  return (sourceAccountType ?? '') as EntryAccountType;
}

/**
 * Returns a warning message when a configured Ledger main account is used
 * with a currency other than the one Finance configured for that account.
 */
export function validateCashLedgerAccountCurrency(
  accountDisplayValue: string | undefined,
  currencyCode: string | undefined,
): string | null {
  const config = getCashLedgerMainAccountConfig(accountDisplayValue);
  if (!config) return null;

  const currency = String(currencyCode ?? '')
    .trim()
    .toUpperCase();
  if (!currency || currency === config.currency) return null;

  return `Account ${accountDisplayValue || config.mainAccount} is configured for ${config.currency} but transaction currency is ${currency}.`;
}

/**
 * Pre-posting guard: a main account known to be Ledger-only must never be
 * resolved as AccountType `Bank`.
 */
export function findCashBankMisclassificationError(
  resolvedAccountType: string | undefined,
  accountDisplayValue: string | undefined,
): string | null {
  if (resolvedAccountType !== 'Bank') return null;

  const normalized = normalizeAccountValue(accountDisplayValue);
  if (isKnownCashMainAccountNeverBank(normalized)) {
    return `Account ${accountDisplayValue || normalized} must be mapped as Ledger, not Bank.`;
  }

  return null;
}
