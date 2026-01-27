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
  TermsOfPayment: string;
  BillingClassification: string;
  CustomerReference: string;
  DefaultDimensionDisplayValue: string;
  PostingProfile: string;
  SalesTaxGroupId: string;
  SalesTaxItemGroupId: string;
  EInvoiceIsLineSpecific: string;
  OverrideSalesTax: string;
  InclTax: string;
  LanguageId: 'en-US';
}

/**
 * Request data for posting a free text invoice line to D365FO
 */
export interface D365FOFreeTextInvoiceLineRequest {
  dataAreaId: string;
  LineNumber: number;
  ParentRecId: number;
  BillingCode: string;
  Description?: string;
  MainAccountDisplayValue: string;
  CurrencyCode?: string;
  UnitPrice: number;
  DefaultDimensionDisplayValue: string;
  Quantity?: number;
  SalesTaxGroupId?: string;
  SalesTaxItemGroupId?: string;
  SalesTaxAmount?: number;
  TransactionCurrencyAmount?: number;
  InvoiceText?: string;
  OverrideSalesTax?: string;
  FixedAssetNumber?: string;
  EInvoiceAccountCode?: string;
  ProjectID?: string;
  StateOfOrigin?: string;
  IsServiceInvoice?: string;
  PrintCode?: string;
  TransactionID?: string;
  TotalWeight?: number;
  NGPCode?: number;
  AssetId?: string;
  ExternalInvoiceId?: string;
  ValueModel?: string;
  AmountDetails?: string;
  CFOPCode?: string;
  FiscalInformationServiceCode?: string;
  CategoryId?: string;
  SalesUnit?: string;
  PropertyNumber?: string;
  CountryRegionId?: string;
  CountryName?: string;
  WithholdingTaxGroup?: string;
  TransactionCode?: string;
  InvoiceGTD?: string;
}
