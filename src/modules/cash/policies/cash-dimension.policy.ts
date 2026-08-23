import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  isKnownCashMainAccountNeverBank,
  resolveWcaMainAccount,
} from '@/modules/cash/policies/cash-account-classification.policy';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

/**
 * Cash custom APIs omit mainAccount and require this exact dimension order.
 * The order is part of the D365FO contract and must not be alphabetized.
 */
export const CASH_API_DIMENSION_FIELDS: Array<keyof EntryDimensionsModel> = [
  'costCenter',
  'activityName',
  'businessUnit',
  'location',
  'customer',
  'subCustomer',
  'vendor',
  'subVendor',
  'chargeType',
  'salesMan',
  'coordinatorMan',
  'freightType',
  'truckerType',
  'truckNumber',
  'direction',
  'worker',
  'fixedAsset',
  'lease',
  'bankAccount',
];

/** Converts a supported dimension value to the trimmed API segment value. */
export function cashDimensionPartAsString(part: unknown): string {
  if (part === null || part === undefined) return '';
  if (typeof part !== 'string' && typeof part !== 'number') return '';
  return typeof part === 'string' ? part.trim() : String(part);
}

/**
 * Trims every segment of a pipe-delimited D365 account/dimension value.
 * Trimming only the complete string is insufficient because spaces can remain
 * before an internal `|` and make an otherwise valid dimension fail in D365.
 */
export function normalizeCashCompositeDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .split('|')
    .map((segment) => segment.trim())
    .join('|');
}

/**
 * Serializes dimensions for a cash custom API request.
 *
 * `mainAccount` is deliberately excluded. Missing FreightType defaults to
 * `Payable` when requested by the caller, preserving the existing outbound
 * line-building behavior.
 */
export function toCashDefaultDimensionDisplayValue(
  dimensions: EntryDimensionsModel | null | undefined,
  defaultFreightType = true,
): string {
  if (!dimensions) return '';

  return CASH_API_DIMENSION_FIELDS.map((fieldName) => {
    if (fieldName === 'freightType') {
      return cashDimensionPartAsString(
        dimensions.freightType || (defaultFreightType ? 'Payable' : ''),
      );
    }
    return cashDimensionPartAsString(dimensions[fieldName]);
  }).join('|');
}

/**
 * Detects when the parsed `bankAccount` financial-dimension segment actually
 * holds a Ledger-only main account value (e.g. a duplicated main account, or
 * a known Ledger-only main account such as 125901/125902/421103). Such a
 * value can never resolve against `BankAccountTable`, so it must not be sent
 * to D365FO as the `BankAccount` financial dimension.
 */
export function findInvalidCashBankAccountDimensionValue(
  dimensions: Pick<EntryDimensionsModel, 'bankAccount' | 'mainAccount'>,
): string {
  const bankAccount = cashDimensionPartAsString(dimensions?.bankAccount);
  if (!bankAccount) return '';

  const mainAccount = cashDimensionPartAsString(dimensions?.mainAccount);
  if (mainAccount && bankAccount === mainAccount) return bankAccount;
  if (isKnownCashMainAccountNeverBank(bankAccount)) return bankAccount;

  return '';
}

/**
 * Clears the `bankAccount` financial-dimension segment in place when it
 * holds an invalid (Ledger-only) main account value, preventing the D365FO
 * `DimAttributeBankAccountTable` posting failure. Returns the cleared value,
 * or an empty string when nothing needed to change.
 */
export function sanitizeCashBankAccountDimension(
  dimensions: EntryDimensionsModel,
): string {
  const invalidValue = findInvalidCashBankAccountDimensionValue(dimensions);
  if (!invalidValue) return '';

  dimensions.bankAccount = undefined;
  return invalidValue;
}

/**
 * Default D365FO Bank Account IDs for Notes Receivable main accounts.
 */
export const NOTES_RECEIVABLE_BANK_ACCOUNTS: Record<string, string> = {
  '122201': 'NR-EGP',
  '122202': 'NR-USD',
  '122203': 'NR-EUR',
  '122204': 'NR-GBP',
  '123510': 'NR-GBP',
};

/**
 * Resolves the cash offset account value sent to D365FO.
 *
 * Bank and petty-cash rows use their source account. Ledger rows use the
 * source account when available and otherwise fall back to the serialized
 * dimension string. Notes-receivable lines prefer the bank-account segment
 * or map to configured D365 Bank Account IDs (NR-EGP, NR-USD, NR-EUR, NR-GBP).
 */
export function resolveCashOffsetAccountDisplayValue(
  offsetLine: CashEntryRawDataModel,
  dimensions: EntryDimensionsModel,
  isNotesReceivable: boolean,
  dimensionStrFallback: string,
): string {
  if (isNotesReceivable) {
    const bankAccount = cashDimensionPartAsString(dimensions.bankAccount);
    if (bankAccount) return bankAccount;

    const mainAccount =
      cashDimensionPartAsString(dimensions.mainAccount) ||
      String(offsetLine.ACCOUNTDISPLAYVALUE || '')
        .trim()
        .split('|')[0]
        ?.trim();

    if (mainAccount && NOTES_RECEIVABLE_BANK_ACCOUNTS[mainAccount]) {
      return NOTES_RECEIVABLE_BANK_ACCOUNTS[mainAccount];
    }
  }

  const accountDisplay = (offsetLine.ACCOUNTDISPLAYVALUE || '').trim();

  // WCA-US / WCA-EUR / 125901 / 125902 must always resolve as Ledger main account
  if (isKnownCashMainAccountNeverBank(accountDisplay)) {
    return resolveWcaMainAccount(accountDisplay);
  }

  if (offsetLine.IsBank || offsetLine.IsPettyCash) {
    return accountDisplay;
  }

  if (accountDisplay) return resolveWcaMainAccount(accountDisplay);

  return dimensionStrFallback;
}
