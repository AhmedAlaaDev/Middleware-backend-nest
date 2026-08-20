import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

export interface CashCustomerCurrencyResolution {
  /** Resolved CurrencyCode to use on the D365FO payload line. */
  currencyCode: string;
  /** True when the customer line's currency differed and was aligned. */
  changed: boolean;
  /** The customer line's currency before alignment (for logging/audit). */
  previousCurrencyCode: string;
}

/**
 * Cash-In 421103 currency rule.
 *
 * The non-customer (offset) line is the source of truth for the transaction
 * currency. When the customer line's currency differs from its paired
 * non-customer line, the customer line inherits the non-customer currency.
 * When both currencies already match, nothing changes.
 *
 * Matching the customer line to its corresponding non-customer line is the
 * responsibility of the existing Cash-In pairing logic (two-line and
 * more-than-two-line grouping). This function only aligns the currency of an
 * already-resolved customer/non-customer pair, and is strictly a Cash-In
 * (inbound) rule — Custody Settlement transactions never reach it because
 * they are filtered out and routed to Cash-Out before invoice grouping.
 */
export function resolveCashInboundCustomerCurrency(
  customerLine: Pick<CashEntryRawDataModel, 'CURRENCYCODE'>,
  nonCustomerLine: Pick<CashEntryRawDataModel, 'CURRENCYCODE'>,
): CashCustomerCurrencyResolution {
  const previousCurrencyCode = String(customerLine?.CURRENCYCODE ?? '').trim();
  const sourceCurrencyCode = String(nonCustomerLine?.CURRENCYCODE ?? '').trim();

  if (!sourceCurrencyCode) {
    return {
      currencyCode: previousCurrencyCode,
      changed: false,
      previousCurrencyCode,
    };
  }

  return {
    currencyCode: sourceCurrencyCode,
    changed:
      Boolean(previousCurrencyCode) &&
      previousCurrencyCode !== sourceCurrencyCode,
    previousCurrencyCode,
  };
}
