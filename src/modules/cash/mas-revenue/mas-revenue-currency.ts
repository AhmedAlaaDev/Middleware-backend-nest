import { normalizeSourceText } from './mas-revenue-workbook.parser';

import type { MasRevenueCashAccountCheck } from './mas-revenue-cash-account-verifier';
import type { MasRevenueVerifiedConfig } from './mas-revenue-config';
import type { MasRevenueReceipt } from './mas-revenue.types';

/**
 * Gives each receipt the currency of its verified D365 cash account. The cash ID comes
 * from the verified configuration. A receipt whose ID, status or currency is missing
 * keeps an empty currency; the blockers then name that cash account and posting is
 * refused. A currency is never guessed.
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
    const id =
      config.cashAccountIdsByDisplayName[
        normalizeSourceText(receipt.cashAccountDisplayName)
      ];
    const check = id ? checkById.get(id) : undefined;
    const currency =
      check && check.status === 'RCASH' && check.currency ? check.currency : '';
    return { ...receipt, currency };
  });
}
