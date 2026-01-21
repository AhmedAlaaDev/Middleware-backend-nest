/**
 * Request data for posting a free text invoice header to D365FO
 */
export interface D365FOFreeTextInvoiceHeaderRequest {
  dataAreaId: string;
  InvoiceAccount: string;
  CustomerAccount: string;
  DocumentDate: string;
  InvoiceDate: string;
  DueDate: string;
  CurrencyCode: string;
  MethodOfPayment: string | null;
  TermsOfPayment: string;
  BillingClassification: string;
  CustomerReference: string;
  DefaultDimensionDisplayValue: string;
}

/**
 * Request data for posting a free text invoice line to D365FO
 */
export interface D365FOFreeTextInvoiceLineRequest {
  dataAreaId: string;
  LineNumber: number;
  ParentRecId: number;
  BillingCode: string;
  Description: string;
  MainAccountDisplayValue: string;
  CurrencyCode: string;
  UnitPrice: number;
  DefaultDimensionDisplayValue: string;
}
