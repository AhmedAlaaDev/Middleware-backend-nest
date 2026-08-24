import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { sanitizeCashOutboundInvoice } from '@/modules/cash/policies/cash-account.policy';
import { firstCashFinancialTag } from '@/modules/cash/policies/cash-invoice.policy';

/**
 * Matches a withholding line to a vendor debit line.
 * Matching precedence is invoice-specific first. A UniqueId can contain many
 * invoices, so using it before invoice would assign the same withholding line
 * to every invoice in the payment group.
 */
export function findVendorPaymentWithholdingLine(
  vendorLine: CashEntryRawDataModel,
  withholdingLines: CashEntryRawDataModel[],
): CashEntryRawDataModel | undefined {
  if (withholdingLines.length === 0) return undefined;

  // 1. Match by invoice (when possible). When the same invoice appears more
  // than once for the vendor/document, operation identifies the exact D365
  // transaction and must win before the invoice-only fallback.
  const invoice = sanitizeCashOutboundInvoice(vendorLine.INVOICE);
  if (invoice) {
    const invoiceMatches = withholdingLines.filter(
      (line) => sanitizeCashOutboundInvoice(line.INVOICE) === invoice,
    );
    const operation = firstCashFinancialTag(vendorLine.FINTAGDISPLAYVALUE);
    const exactOperationMatch = operation
      ? invoiceMatches.find(
          (line) =>
            firstCashFinancialTag(line.FINTAGDISPLAYVALUE) === operation,
        )
      : undefined;
    if (exactOperationMatch) return exactOperationMatch;
    if (invoiceMatches.length > 0) return invoiceMatches[0];
  }

  // 2. Match by Document + Currency + Operation.
  const operation = firstCashFinancialTag(vendorLine.FINTAGDISPLAYVALUE);
  const operationMatch = operation
    ? withholdingLines.find(
        (line) =>
          String(line.DOCUMENT ?? '').trim() ===
            String(vendorLine.DOCUMENT ?? '').trim() &&
          line.CURRENCYCODE === vendorLine.CURRENCYCODE &&
          firstCashFinancialTag(line.FINTAGDISPLAYVALUE) === operation,
      )
    : undefined;
  if (operationMatch) return operationMatch;

  // 3. UniqueId/VOUCHER are last-resort fallbacks only when an invoice- or
  // operation-specific withholding row is unavailable.
  if (vendorLine.UniqueId) {
    const uniqueIdMatch = withholdingLines.find(
      (line) =>
        String(line.UniqueId ?? '').trim() ===
        String(vendorLine.UniqueId ?? '').trim(),
    );
    if (uniqueIdMatch) return uniqueIdMatch;
  }

  if (vendorLine.VOUCHER) {
    return withholdingLines.find(
      (line) =>
        String(line.VOUCHER ?? '').trim() ===
        String(vendorLine.VOUCHER ?? '').trim(),
    );
  }

  return undefined;
}

/**
 * Allocates each 223304 source row once. Exact invoice+operation matches are
 * reserved first so a repeated invoice cannot let an earlier, different
 * operation steal the withholding row through the invoice-only fallback.
 */
export function allocateVendorPaymentWithholdingLines(
  vendorLines: CashEntryRawDataModel[],
  withholdingLines: CashEntryRawDataModel[],
): Map<CashEntryRawDataModel, CashEntryRawDataModel> {
  const allocation = new Map<
    CashEntryRawDataModel,
    CashEntryRawDataModel
  >();
  const claimed = new Set<CashEntryRawDataModel>();

  for (const vendorLine of vendorLines) {
    const invoice = sanitizeCashOutboundInvoice(vendorLine.INVOICE);
    const operation = firstCashFinancialTag(vendorLine.FINTAGDISPLAYVALUE);
    if (!invoice || !operation) continue;

    const exact = withholdingLines.find(
      (line) =>
        !claimed.has(line) &&
        sanitizeCashOutboundInvoice(line.INVOICE) === invoice &&
        firstCashFinancialTag(line.FINTAGDISPLAYVALUE) === operation,
    );
    if (!exact) continue;
    allocation.set(vendorLine, exact);
    claimed.add(exact);
  }

  for (const vendorLine of vendorLines) {
    if (allocation.has(vendorLine)) continue;
    const invoice = sanitizeCashOutboundInvoice(vendorLine.INVOICE);
    const invoiceWasAlreadyClaimed =
      Boolean(invoice) &&
      withholdingLines.some(
        (line) => sanitizeCashOutboundInvoice(line.INVOICE) === invoice,
      ) &&
      !withholdingLines.some(
        (line) =>
          !claimed.has(line) &&
          sanitizeCashOutboundInvoice(line.INVOICE) === invoice,
      );
    if (invoiceWasAlreadyClaimed) continue;
    const match = findVendorPaymentWithholdingLine(
      vendorLine,
      withholdingLines.filter((line) => !claimed.has(line)),
    );
    if (!match) continue;
    allocation.set(vendorLine, match);
    claimed.add(match);
  }

  return allocation;
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
