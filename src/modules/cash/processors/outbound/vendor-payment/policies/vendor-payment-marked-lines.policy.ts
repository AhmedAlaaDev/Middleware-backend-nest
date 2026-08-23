import { VendorPaymentMarkingResult } from '../models/vendor-payment-marking-result';

import { isVendorPaymentWithholdingEnabled } from './vendor-payment-withholding.policy';

import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { resolveCashOutboundInvoice } from '@/modules/cash/policies/cash-account.policy';
import { firstCashFinancialTag } from '@/modules/cash/policies/cash-invoice.policy';

export interface VendorPaymentSettlement {
  vendorLine: CashEntryRawDataModel;
  withholdingLine?: CashEntryRawDataModel;
}

function invoiceForD365Posting(vendorLine: CashEntryRawDataModel): string {
  const exactD365Invoice = String(vendorLine.ResolvedD365InvoiceNumber ?? '');
  if (resolveCashOutboundInvoice(exactD365Invoice)) {
    return exactD365Invoice;
  }
  return resolveCashOutboundInvoice(
    vendorLine.MARKEDINVOICE,
    vendorLine.INVOICE,
  );
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

  const sanitizedInvoice = resolveCashOutboundInvoice(
    primaryVendorLine.MARKEDINVOICE,
    primaryVendorLine.INVOICE,
  );
  const documentNum = String(primaryVendorLine.DOCUMENT ?? '').trim();

  if (!sanitizedInvoice) {
    return VendorPaymentMarkingResult.unmarked({
      documentNum,
      reason: 'no valid invoice found after sanitization',
    });
  }

  if (
    !isCustody &&
    settlements.some(
      ({ vendorLine }) =>
        !resolveCashOutboundInvoice(
          vendorLine.MARKEDINVOICE,
          vendorLine.INVOICE,
        ) || !String(vendorLine.DOCUMENT ?? '').trim(),
    )
  ) {
    return VendorPaymentMarkingResult.unmarked({
      documentNum,
      reason:
        'vendor settlement requires invoice and document on every marked line',
    });
  }

  const markedLines = settlements.map(({ vendorLine, withholdingLine }) => ({
    InvoiceNumber: isCustody ? '' : invoiceForD365Posting(vendorLine),
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
