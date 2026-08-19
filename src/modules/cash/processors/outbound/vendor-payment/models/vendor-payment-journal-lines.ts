import { VendorPaymentMarkingResult } from './vendor-payment-marking-result';

import { CashEntryMarkedLine } from '@/modules/cash/models/cash-entry-dyn-data.model';

/**
 * The immutable Product of the VendorPaymentBuilder.
 *
 * Constructible only when all required parts are present. Enforces that
 * MarkedLines/MarkedInvoice are consistent with the MarkingResult invariant.
 */
export interface VendorPaymentLineData {
  accountDisplayValue: string;
  accountType: string;
  vendorGroup: string;
  debitAmount: number;
  creditAmount: number;
  currencyCode: string;
  exchangeRate: number;
  reportingCurrencyExchRate: number;
  transactionDate: string;
  description: string;
  transactionText: string;
  offsetTransactionText: string;
  paymentMethodName: string;
  paymentReference: string;
  offsetAccountDisplayValue: string;
  offsetAccountType: string;
  offsetCompany: string;
  journalName: string;
  defaultDimensionDisplayValue: string;
  offsetDefaultDimensionDisplayValue: string;
  finTagDisplayValue: string;
  offsetFinTagDisplayValue: string;
  salesTaxGroup: string;
  itemSalesTaxGroup: string;
  isWithholdingCalculationEnabled: 'Yes' | 'No';
  itemWithholdingTaxGroupCode: string;
  postingProfile: string;
  invoice: string;
  documentNum: string;
  documentDate: string;
  dueDate: string;
  voucherType: string;
  safeType: string;
  paymentId: string;
  document: string;
  settlementTargetType: 'VendorInvoice' | 'CustodyLedger' | 'None';
}

export class VendorPaymentJournalLines {
  readonly vendorLine: VendorPaymentLineData;
  readonly markingResult: VendorPaymentMarkingResult;
  readonly markedInvoice: string;
  readonly markedLines: readonly CashEntryMarkedLine[];

  private constructor(
    vendorLine: VendorPaymentLineData,
    markingResult: VendorPaymentMarkingResult,
  ) {
    this.vendorLine = Object.freeze({ ...vendorLine });
    this.markingResult = markingResult;
    this.markedInvoice = markingResult.markedInvoice;
    this.markedLines = markingResult.markedLines;
  }

  static create(
    vendorLine: VendorPaymentLineData,
    markingResult: VendorPaymentMarkingResult,
  ): VendorPaymentJournalLines {
    if (!vendorLine.accountDisplayValue) {
      throw new Error(
        'VendorPaymentJournalLines: accountDisplayValue is required',
      );
    }
    if (!vendorLine.currencyCode) {
      throw new Error('VendorPaymentJournalLines: currencyCode is required');
    }
    if (!vendorLine.documentNum && markingResult.shouldMark) {
      throw new Error(
        'VendorPaymentJournalLines: documentNum is required when marking is enabled',
      );
    }
    return new VendorPaymentJournalLines(vendorLine, markingResult);
  }
}
