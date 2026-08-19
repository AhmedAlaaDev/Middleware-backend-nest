import {
  VendorPaymentJournalLines,
  VendorPaymentLineData,
} from './models/vendor-payment-journal-lines';
import { VendorPaymentMarkingResult } from './models/vendor-payment-marking-result';

export interface VendorPaymentBuildContext {
  accountDisplayValue: string;
  accountType: string;
  vendorGroup: string;
  debitAmount: number;
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
  documentDate: string;
  dueDate: string;
  voucherType: string;
  safeType: string;
  paymentId: string;
  document: string;
  settlementTargetType: 'VendorInvoice' | 'CustodyLedger' | 'None';
  markingResult: VendorPaymentMarkingResult;
}

/**
 * Stepwise builder for VendorPaymentJournalLines.
 * Each setter reads from the build context — no external calls.
 * The Builder does NOT decide marking; it copies MarkingResult verbatim.
 */
export class VendorPaymentBuilder {
  private lineData: Partial<VendorPaymentLineData> = {};
  private marking: VendorPaymentMarkingResult | undefined;

  setVendorLines(ctx: VendorPaymentBuildContext): this {
    this.lineData.accountDisplayValue = ctx.accountDisplayValue;
    this.lineData.accountType = ctx.accountType;
    this.lineData.vendorGroup = ctx.vendorGroup;
    this.lineData.debitAmount = ctx.debitAmount;
    this.lineData.creditAmount = 0;
    return this;
  }

  setOffsetLine(ctx: VendorPaymentBuildContext): this {
    this.lineData.offsetAccountDisplayValue = ctx.offsetAccountDisplayValue;
    this.lineData.offsetAccountType = ctx.offsetAccountType;
    this.lineData.offsetCompany = ctx.offsetCompany;
    this.lineData.paymentMethodName = ctx.paymentMethodName;
    this.lineData.paymentReference = ctx.paymentReference;
    return this;
  }

  setWithholdingLine(ctx: VendorPaymentBuildContext): this {
    this.lineData.isWithholdingCalculationEnabled =
      ctx.isWithholdingCalculationEnabled;
    this.lineData.itemWithholdingTaxGroupCode = ctx.itemWithholdingTaxGroupCode;
    return this;
  }

  setInvoiceFields(ctx: VendorPaymentBuildContext): this {
    this.lineData.invoice = ctx.invoice;
    return this;
  }

  setMarkedLines(ctx: VendorPaymentBuildContext): this {
    this.marking = ctx.markingResult;
    return this;
  }

  setDocumentNum(ctx: VendorPaymentBuildContext): this {
    this.lineData.documentNum = ctx.markingResult.documentNum;
    this.lineData.document = ctx.document;
    this.lineData.documentDate = ctx.documentDate;
    this.lineData.dueDate = ctx.dueDate;
    return this;
  }

  setDimensions(ctx: VendorPaymentBuildContext): this {
    this.lineData.defaultDimensionDisplayValue =
      ctx.defaultDimensionDisplayValue;
    this.lineData.offsetDefaultDimensionDisplayValue =
      ctx.offsetDefaultDimensionDisplayValue;
    this.lineData.finTagDisplayValue = ctx.finTagDisplayValue;
    this.lineData.offsetFinTagDisplayValue = ctx.offsetFinTagDisplayValue;
    return this;
  }

  setCurrencyAndExchangeRate(ctx: VendorPaymentBuildContext): this {
    this.lineData.currencyCode = ctx.currencyCode;
    this.lineData.exchangeRate = ctx.exchangeRate;
    this.lineData.reportingCurrencyExchRate = ctx.reportingCurrencyExchRate;
    return this;
  }

  setDebitCredit(ctx: VendorPaymentBuildContext): this {
    this.lineData.debitAmount = ctx.debitAmount;
    this.lineData.creditAmount = 0;
    return this;
  }

  setRemainingFields(ctx: VendorPaymentBuildContext): this {
    this.lineData.transactionDate = ctx.transactionDate;
    this.lineData.description = ctx.description;
    this.lineData.transactionText = ctx.transactionText;
    this.lineData.offsetTransactionText = ctx.offsetTransactionText;
    this.lineData.journalName = ctx.journalName;
    this.lineData.salesTaxGroup = ctx.salesTaxGroup;
    this.lineData.itemSalesTaxGroup = ctx.itemSalesTaxGroup;
    this.lineData.postingProfile = ctx.postingProfile;
    this.lineData.voucherType = ctx.voucherType;
    this.lineData.safeType = ctx.safeType;
    this.lineData.paymentId = ctx.paymentId;
    this.lineData.settlementTargetType = ctx.settlementTargetType;
    return this;
  }

  build(): VendorPaymentJournalLines {
    if (!this.marking) {
      throw new Error('VendorPaymentBuilder: markingResult is required');
    }
    return VendorPaymentJournalLines.create(
      this.lineData as VendorPaymentLineData,
      this.marking,
    );
  }
}
