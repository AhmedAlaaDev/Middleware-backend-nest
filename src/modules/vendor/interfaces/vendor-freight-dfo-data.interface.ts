import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';

export class IVendorFreightDFOLine {
  journalBatchNum: number;
  lineNumber: number;
  dimensions: AccountDimensionsModel;
  accountType: 'Vend' | 'Ledger';
  company: string;
  credit: number;
  debit: number;
  currency: string;
  date: string;
  description: string;
  document: number;
  dueDate: string;
  exchangeRate: number;
  exchangeRateSecond: number;
  fineTagDisplayValue: any;
  invoice: string;
  invoiceDate: string;
  isWithHoldingTaxCalculate: boolean;
  itemSalesTaxGroup: string;
  itemWithholdingTaxGroupCode: string;
  methodOfPayment: string;
  offsetAccountDisplayValue: string;
  offsetAccountType: string;
  offsetCompany: string;
  offsetDefaultDimensionDisplayValue: string;
  offsetFinTagDisplayValue: string;
  offsetTransactionText: string;
  overrideSalesTax: string;
  payMid: number;
  postingProfile: string;
  reportingCurrencyExchange: number;
  salesTaxGroup: string;
  taxExemptNumber: string;
  termsOfPayment: string;
  transactionType: string;
  voucher: number;
}

interface VendorFreightDFOData {
  journalBatchNum: number;
  description: string;
  isPosted: boolean;
  journalName: string;
  journalTotalCredit: number;
  journalTotalDebit: number;
  oversideSalesTax: boolean;
  salesTaxIncluded: boolean;
  lines: IVendorFreightDFOLine[];
  sourceIds: string[];
}

export class IVendorFreightDFOData {
  journalBatchNum: number;
  description: string;
  isPosted: boolean;
  journalName: string;
  journalTotalCredit: number;
  journalTotalDebit: number;
  oversideSalesTax: boolean;
  salesTaxIncluded: boolean;
  lines: IVendorFreightDFOLine[];
  sourceIds: string[];

  private errors: Array<{ property: string; message: string }> = [];

  constructor(data: VendorFreightDFOData) {
    this.journalBatchNum = data.journalBatchNum;
    this.description = data.description;
    this.isPosted = data.isPosted;
    this.journalName = data.journalName;
    this.journalTotalCredit = data.journalTotalCredit;
    this.journalTotalDebit = data.journalTotalDebit;
    this.oversideSalesTax = data.oversideSalesTax;
    this.salesTaxIncluded = data.salesTaxIncluded;
    this.lines = data.lines;
    this.sourceIds = data.sourceIds;
  }

  get errorCount(): number {
    return this.errors.length;
  }

  get errorsText(): string {
    if (this.errors.length === 0) {
      return '';
    }
    return this.errors.map((e) => `${e.property}: ${e.message}`).join(';');
  }

  addError(property: string, message: string): void {
    this.errors.push({ property, message });
  }

  getErrors(): string[] {
    return this.errors.map((e) => `${e.property}: ${e.message}`);
  }
}
