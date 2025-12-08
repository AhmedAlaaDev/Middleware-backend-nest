import { DynDataModel } from '@/modules/entry-processor/models/dyn-data-model';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';

export class DynAccountReceivableLineDto extends DynDataModel {
  customId: number;
  uniqueId?: number;
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

  get errorsText(): string {
    if (this.errorCount === 0) {
      return '';
    }
    return this.getErrors().join(';');
  }
}
