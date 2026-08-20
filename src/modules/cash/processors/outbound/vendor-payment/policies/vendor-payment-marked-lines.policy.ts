import { VendorPaymentMarkingResult } from '../models/vendor-payment-marking-result';
import { isVendorPaymentWithholdingEnabled } from './vendor-payment-withholding.policy';

import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { sanitizeCashOutboundInvoice } from '@/modules/cash/policies/cash-account.policy';
import { firstCashFinancialTag } from '@/modules/cash/policies/cash-invoice.policy';

export interface VendorPaymentSettlement {
  vendorLine: CashEntryRawDataModel;
  withholdingLine?: CashEntryRawDataModel;
}

/**
 * The ONLY component that decides whether a Vendor Payment should be marked.
 * Returns a single atomic MarkingResult that no downstream component may override.
 */
export function resolveVendorPaymentMarking(options: {
  settlements: VendorPaymentSettlement[];
  offsetLine: CashEntryRawDataModel;
  vendorGroup: string;
}): VendorPaymentMarkingResult {
  const { settlements, offsetLine, vendorGroup } = options;
  const isCustody = vendorGroup.toLowerCase() === 'custody';

  const primaryVendorLine = settlements[0]?.vendorLine;
  if (!primaryVendorLine) {
    return VendorPaymentMarkingResult.unmarked({
      documentNum: '',
      reason: 'no vendor lines in settlement',
    });
  }

  const rawInvoice =
    primaryVendorLine.MARKEDINVOICE ||
    offsetLine.MARKEDINVOICE ||
    primaryVendorLine.INVOICE ||
    offsetLine.INVOICE ||
    primaryVendorLine.DOCUMENT ||
    offsetLine.DOCUMENT;
  const sanitizedInvoice = sanitizeCashOutboundInvoice(rawInvoice);
  const documentNum = String(primaryVendorLine.DOCUMENT ?? '').trim();

  if (!sanitizedInvoice) {
    return VendorPaymentMarkingResult.unmarked({
      documentNum,
      reason: 'no valid invoice found after sanitization',
    });
  }

  const markedLines = settlements.map(({ vendorLine, withholdingLine }) => ({
    InvoiceNumber: isCustody
      ? ''
      : sanitizeCashOutboundInvoice(
          vendorLine.MARKEDINVOICE || vendorLine.INVOICE || vendorLine.DOCUMENT,
        ),
    OperationNumber: firstCashFinancialTag(vendorLine.FINTAGDISPLAYVALUE),
    // D365 settlement can require the source document even for non-custody
    // vendor payments; do not suppress it when an invoice is also present.
    DocumentNumber: String(vendorLine.DOCUMENT ?? '').trim(),
    HasWithHoldingLine: isVendorPaymentWithholdingEnabled({
      vendorLine,
      withholdingLine,
      offsetLine,
    }),
  }));

  return VendorPaymentMarkingResult.marked({
    markedLines,
    markedInvoice: sanitizedInvoice,
    documentNum,
    reason: isCustody
      ? 'custody vendor settlement'
      : 'normal vendor invoice settlement',
  });
}
