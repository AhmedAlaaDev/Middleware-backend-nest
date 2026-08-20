import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { sanitizeCashOutboundInvoice } from '@/modules/cash/policies/cash-account.policy';
import { firstCashFinancialTag } from '@/modules/cash/policies/cash-invoice.policy';

/**
 * Matches a withholding line to a vendor debit line.
 * Preserves the existing matching precedence:
 * 1. By invoice (when possible)
 * 2. By Document + Currency + Operation (fallback)
 */
export function findVendorPaymentWithholdingLine(
  vendorLine: CashEntryRawDataModel,
  withholdingLines: CashEntryRawDataModel[],
): CashEntryRawDataModel | undefined {
  if (withholdingLines.length === 0) return undefined;

  // 1. Match by UniqueId (if both have UniqueId)
  if (vendorLine.UniqueId) {
    const uMatch = withholdingLines.find(
      (line) =>
        String(line.UniqueId ?? '').trim() ===
        String(vendorLine.UniqueId ?? '').trim(),
    );
    if (uMatch) return uMatch;
  }

  // 2. Match by VOUCHER (if both have VOUCHER)
  if (vendorLine.VOUCHER) {
    const vMatch = withholdingLines.find(
      (line) =>
        String(line.VOUCHER ?? '').trim() ===
        String(vendorLine.VOUCHER ?? '').trim(),
    );
    if (vMatch) return vMatch;
  }

  // 3. Match by invoice (when possible)
  const invoice = sanitizeCashOutboundInvoice(vendorLine.INVOICE);
  if (invoice) {
    const invoiceMatch = withholdingLines.find(
      (line) => sanitizeCashOutboundInvoice(line.INVOICE) === invoice,
    );
    if (invoiceMatch) return invoiceMatch;
  }

  // 4. Match by Document + Currency + Operation (fallback)
  const operation = firstCashFinancialTag(vendorLine.FINTAGDISPLAYVALUE);
  return withholdingLines.find(
    (line) =>
      String(line.DOCUMENT ?? '').trim() ===
        String(vendorLine.DOCUMENT ?? '').trim() &&
      line.CURRENCYCODE === vendorLine.CURRENCYCODE &&
      firstCashFinancialTag(line.FINTAGDISPLAYVALUE) === operation,
  );
}

/**
 * Determines whether withholding calculation is enabled for a vendor payment.
 */
export function isVendorPaymentWithholdingEnabled(options: {
  vendorLine: CashEntryRawDataModel;
  withholdingLine?: CashEntryRawDataModel;
  offsetLine: CashEntryRawDataModel;
}): boolean {
  const { vendorLine, withholdingLine, offsetLine } = options;

  return (
    String(vendorLine.ISWITHHOLDINGCALCULATIONENABLED ?? '').toLowerCase() ===
      'yes' ||
    (!!vendorLine.ITEMWITHHOLDINGTAXGROUPCODE &&
      String(vendorLine.ITEMWITHHOLDINGTAXGROUPCODE).trim() !== '' &&
      String(vendorLine.ITEMWITHHOLDINGTAXGROUPCODE).trim() !== '0') ||
    Boolean(withholdingLine) ||
    String(offsetLine.ISWITHHOLDINGCALCULATIONENABLED ?? '').toLowerCase() ===
      'yes' ||
    (!!offsetLine.ITEMWITHHOLDINGTAXGROUPCODE &&
      String(offsetLine.ITEMWITHHOLDINGTAXGROUPCODE).trim() !== '' &&
      String(offsetLine.ITEMWITHHOLDINGTAXGROUPCODE).trim() !== '0') ||
    !!(vendorLine as any).hasWithholdingReduction ||
    !!(offsetLine as any).hasWithholdingReduction
  );
}
