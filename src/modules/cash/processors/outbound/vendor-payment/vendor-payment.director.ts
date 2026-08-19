import { VendorPaymentJournalLines } from './models/vendor-payment-journal-lines';
import {
  VendorPaymentBuildContext,
  VendorPaymentBuilder,
} from './vendor-payment.builder';

/**
 * Owns the fixed construction sequence for Vendor Payment journal lines.
 * The ordering here is literal and diffable — it is the single place where
 * "existing line ordering is preserved" lives as code.
 */
export class VendorPaymentDirector {
  construct(
    builder: VendorPaymentBuilder,
    context: VendorPaymentBuildContext,
  ): VendorPaymentJournalLines {
    return builder
      .setVendorLines(context)
      .setOffsetLine(context)
      .setWithholdingLine(context)
      .setInvoiceFields(context)
      .setMarkedLines(context)
      .setDocumentNum(context)
      .setDimensions(context)
      .setCurrencyAndExchangeRate(context)
      .setDebitCredit(context)
      .setRemainingFields(context)
      .build();
  }
}
