import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { sanitizeCashOutboundInvoice } from '@/modules/cash/policies/cash-account.policy';

/**
 * Resolves the normalized invoice value for a Vendor Payment.
 * Determines: which raw field is the invoice source, blank/zero handling,
 * which invoice participates in settlement.
 *
 * Does NOT perform D365 calls.
 */
export function resolveVendorPaymentInvoice(
  vendorLine: CashEntryRawDataModel,
  offsetLine: CashEntryRawDataModel,
): string {
  const rawInvoice =
    vendorLine.MARKEDINVOICE ||
    offsetLine.MARKEDINVOICE ||
    vendorLine.INVOICE ||
    offsetLine.INVOICE ||
    vendorLine.DOCUMENT ||
    offsetLine.DOCUMENT;

  return sanitizeCashOutboundInvoice(rawInvoice);
}
