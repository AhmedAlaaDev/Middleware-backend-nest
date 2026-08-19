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

  const invoice = sanitizeCashOutboundInvoice(vendorLine.INVOICE);
  if (invoice) {
    const invoiceMatch = withholdingLines.find(
      (line) => sanitizeCashOutboundInvoice(line.INVOICE) === invoice,
    );
    if (invoiceMatch) return invoiceMatch;
  }

  const operation = firstCashFinancialTag(vendorLine.FINTAGDISPLAYVALUE);
  return withholdingLines.find(
    (line) =>
      line.DOCUMENT === vendorLine.DOCUMENT &&
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
