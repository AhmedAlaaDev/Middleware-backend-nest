import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';

export class DynAccountReceivableLineDto {
  customId: number;
  uniqueId?: number;
  lineNumber?: number;
  freeTextNumber: string;
  documentDate: Date;
  dueDate?: Date;
  cashDiscountDate?: Date;
  invoiceDate?: Date;
  customerAccount: string;
  customerReference: string;
  customerRequisition?: string;
  invoiceAccount: string;
  headerDefaultDimensionDisplayValue: string;
  headerFinTagDisplayValue: string;
  defaultDimensionDisplayValue: string;
  lineFinTagDisplayValue: string;
  ledgerDimensionDisplayValue: string;
  description: string;
  quantity: number;
  invoiceTxt: string;
  unitPrice: number;
  amountCur: number;
  salesTaxGroup: string;
  salesTaxItemGroup: string;
  overrideSalesTax: string;
  inclTax: string;
  billingClassification: string;
  billingCode?: string;
  cashDiscountCode?: string;
  methodOfPayment?: string;
  termsOfPayment?: string;
  directDebitMandateId?: string;
  postingProfile: string;
  eInvoiceAccountCode?: string;
  eInvoiceIsLineSpecific: string;
  currencyCode: string;
  transportationDocumentLineId?: string;
  creditNoteInvoiceRef?: string;
  dimensionModel?: AccountDimensionsModel;
  sourceIds: string[] = [];

  private errors: Array<{ property: string; message: string }> = [];

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
