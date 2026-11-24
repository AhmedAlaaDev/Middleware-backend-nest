import { normalizeSourceText } from './mas-revenue-workbook.parser';

import type { MasRevenueCashAccountCheck } from './mas-revenue-cash-account-verifier';
import type { MasRevenueVerifiedConfig } from './mas-revenue-config';
import type { MasRevenueReceipt } from './mas-revenue.types';

/**
 * The D365 cash account ID to read a receipt's currency from. The verified
 * configuration maps a source display name to its cash ID. Without an entry, the
 * value in the sheet is itself looked up as the D365 cash account ID, which is how
 * the account column of the English workbook is written ("Port Said").
 *
 * This only decides which D365 cash account to read the currency from. It does not
 * map the account for posting: posting still needs the verified cash-account
 * configuration.
 */
export function cashAccountIdForCurrency(
  receipt: Pick<MasRevenueReceipt, 'cashAccountDisplayName'>,
  config: Pick<MasRevenueVerifiedConfig, 'cashAccountIdsByDisplayName'>,
): string {
  const name = normalizeSourceText(receipt.cashAccountDisplayName);
  const configured = config.cashAccountIdsByDisplayName[name];
  return configured && configured.trim() !== '' ? configured : name;
}

/**
 * Cash IDs that are not in the verified configuration and therefore need their own
 * read-only D365 lookup to find the currency. Empty when every receipt is configured.
 */
export function cashIdsToLookUp(
  receipts: ReadonlyArray<Pick<MasRevenueReceipt, 'cashAccountDisplayName'>>,
  config: Pick<MasRevenueVerifiedConfig, 'cashAccountIdsByDisplayName'>,
): string[] {
  const configuredIds = new Set(
    Object.values(config.cashAccountIdsByDisplayName),
  );
  const ids = new Set<string>();
  for (const receipt of receipts) {
    const id = cashAccountIdForCurrency(receipt, config);
    if (id && !configuredIds.has(id)) ids.add(id);
  }
  return [...ids];
}

/**
 * Gives each receipt the currency of its D365 cash account. A receipt whose account
 * is not found as an RCash account, or has no currency, keeps an empty currency; the
 * blockers then name that cash account and posting is refused. A currency is never
 * guessed.
 *
 * Used at review time and again at posting time, so a corrected configuration takes
 * effect on an existing batch without a new upload.
 */
export function resolveReceiptCurrencies(
  receipts: MasRevenueReceipt[],
  config: MasRevenueVerifiedConfig,
  checks: MasRevenueCashAccountCheck[],
): MasRevenueReceipt[] {
  const checkById = new Map(checks.map((check) => [check.id, check]));
  return receipts.map((receipt) => {
    const check = checkById.get(cashAccountIdForCurrency(receipt, config));
    const currency =
      check && check.status === 'RCASH' && check.currency ? check.currency : '';
    return { ...receipt, currency };
  });
}

/**
 * Currency of template version 2 rows. The cash ID is the value in the row itself, so
 * there is no mapping: each receipt takes the D365 currency of that RCash account.
 */
export function resolveJournalCurrencies(
  receipts: MasRevenueReceipt[],
  checks: MasRevenueCashAccountCheck[],
): MasRevenueReceipt[] {
  const checkById = new Map(checks.map((check) => [check.id, check]));
  return receipts.map((receipt) => {
    const check = checkById.get(receipt.cashAccountDisplayName.trim());
    const currency =
      check && check.status === 'RCASH' && check.currency ? check.currency : '';
    return { ...receipt, currency };
  });
}
