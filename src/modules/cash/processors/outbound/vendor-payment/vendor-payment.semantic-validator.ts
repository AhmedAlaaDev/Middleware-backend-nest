import { VendorPaymentMarkingResult } from './models/vendor-payment-marking-result';

import { VendorInvoiceSettlementSnapshot } from '@/modules/d365fo/services/vendor-invoice-journal.service';

export interface VendorPaymentSemanticError {
  field: string;
  message: string;
}

/**
 * Validates Vendor Payment decisions against external facts.
 * Runs AFTER lookup and AFTER policy resolution.
 * Does NOT re-decide marking — only checks consistency.
 */
export function validateVendorPaymentSemantics(options: {
  markingResult: VendorPaymentMarkingResult;
  vendorAccount: string;
  currencyCode?: string;
  invoiceLookup: (
    invoice: string,
    vendor: string,
  ) => VendorInvoiceSettlementSnapshot;
}): VendorPaymentSemanticError[] {
  const { markingResult, vendorAccount, invoiceLookup, currencyCode } = options;
  const errors: VendorPaymentSemanticError[] = [];

  if (!markingResult.shouldMark) {
    return errors;
  }

  for (const markedLine of markingResult.markedLines) {
    const invoice = markedLine.InvoiceNumber;
    if (!invoice) continue; // Custody uses DocumentNumber instead

    const lookup = invoiceLookup(invoice, vendorAccount);

    if (!lookup.exists) {
      errors.push({
        field: 'MarkedInvoice',
        message: `Vendor invoice ${invoice} was not found in D365 for vendor ${vendorAccount}.`,
      });
    } else if (!lookup.belongsToVendor) {
      errors.push({
        field: 'MarkedInvoice',
        message: `Vendor invoice ${invoice} does not belong to vendor ${vendorAccount}.`,
      });
    } else if (lookup.isOpen === false) {
      errors.push({
        field: 'MarkedInvoice',
        message: `Vendor invoice ${invoice} is already closed/settled in D365 for vendor ${vendorAccount}.`,
      });
    } else if (
      lookup.currencyCode &&
      currencyCode &&
      lookup.currencyCode.trim().toLowerCase() !==
        currencyCode.trim().toLowerCase()
    ) {
      errors.push({
        field: 'CurrencyCode',
        message: `Vendor invoice ${invoice} is in currency ${lookup.currencyCode}, but the payment line is ${currencyCode}.`,
      });
    }
  }

  return errors;
}
