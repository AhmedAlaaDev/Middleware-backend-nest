import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';

class VendorTruckingDFOLine {
  header: IVendorTruckingDFOHeader;
  journalBatchNum: number;
  lineNumber: number;
  dimensionModel: AccountDimensionsModel;
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
  sourceIds: string[];

  constructor(data: VendorTruckingDFOLine) {
    Object.assign(this, data);
  }
}

export class IVendorTruckingDFOLine extends VendorTruckingDFOLine {
  private errors: Array<{ property: string; message: string }> = [];

  constructor(data: VendorTruckingDFOLine) {
    super(data);
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

export class IVendorTruckingDFOHeader {
  journalBatchNum: number;
  description: string;
  isPosted: boolean;
  journalName: string;
  journalTotalCredit: number;
  journalTotalDebit: number;
  oversideSalesTax: boolean;
  salesTaxIncluded: boolean;

  constructor(data: IVendorTruckingDFOHeader) {
    Object.assign(this, data);
  }
}
