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
  PostingProfile?: string;
  SalesTaxGroupId?: string;
  SalesTaxItemGroupId?: string;
  LanguageId?: string;
  InvoiceName?: string;
  CustomerRequisition?: string;
  EInvoiceAccountCode?: string;
  EInvoiceIsLineSpecific?: string;
  OverrideSalesTax?: string;
  InclTax?: string;
  CashDiscountCode?: string;
  CashDiscountPercentage?: number;
  PaymentTermsBaseDays?: number;
  PaymentTermsBaseDate?: string;
  CashDiscountDate?: string;
  DirectDebitMandateReference?: string;
  PostponedVAT?: string;
  IsOneTimeCustomer?: string;
  IsFinalUser?: string;
  IsServiceDeliveryAddressBased?: string;
  IsPostedViaIntercompany?: string;
  GiroType?: string;
  PaymentSchedule?: string;
  BankAccountId?: string;
  ExternalInvoiceId?: string;
  ConsigneeAccount?: string;
  ConsignorAccount?: string;
  ContactPersonId?: string;
  FiscalDocumentTypeId?: string;
  FiscalDocumentOperationTypeId?: string;
  FiscalOperationPresenceType?: string;
  FiscalEstablishmentId?: string;
  CFOPCode?: string;
  CFPSCode?: string;
  InvoiceOriginCode?: string;
  TransportationDocumentLineId?: string;
  CentralBankPurposeCode?: string;
  CentralBankPurposeText?: string;
  numberSequenceGroup?: string;
  SalesDate?: string;
  ExchangeRate?: number;
  CashFlowForecast?: number;
  CorrectedInvoiceId?: string;
  CorrectedInvoiceDate?: string;
  CorrectedFactureDate?: string;
  CorrectedFactureExternalId?: string;
  CorrectedPeriod?: string;
  ComplimentedInvoiceId?: string;
  AdjustingInvoiceDate?: string;
  CorrectionType?: string;
  ComplementaryFiscalDocumentType?: string;
  VatDueDate?: string;
  NonRealRevenue?: string;
  IsCorrection?: string;
  CustomerPaymentFineCode?: string;
  CustomerPaymentFinancialInterestCode?: string;
  CustomerGroup?: string;
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
