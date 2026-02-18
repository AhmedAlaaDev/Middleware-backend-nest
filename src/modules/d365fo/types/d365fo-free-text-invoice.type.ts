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

/**
 * Options for getByInvoiceNumbers (batch lookup of free text invoices by number)
 */
export interface GetByInvoiceNumbersOptions {
  /**
   * The invoice numbers to lookup.
   */
  invoiceNumbers: string[];
  /**
   * The company to lookup.
   */
  company: string;
  /**
   * The chunk size to use for the batch lookup.
   * @default 200
   * @max 200
   */
  chunkSize?: number;
  /**
   * The concurrency to use for the batch lookup.
   * @default 3
   * @max 10
   */
  concurrency?: number;
}

/**
 * Result of a single free text invoice lookup by number (exists, isPosted, company)
 */
export interface FreeTextInvoiceLookupResult {
  invoiceNumber: string;
  exists: boolean;
  isPosted: boolean;
  company: string;
}

export type FreeTextInvoicesByInvoiceDateRangeParams = {
  company: string; // dataAreaId (required)
  from: string | Date; // inclusive
  to: string | Date; // exclusive
};

// Kept for the required function signature naming.
export type GetFreeTextInvoicesByInvoiceDateRangeParams =
  FreeTextInvoicesByInvoiceDateRangeParams;

export type FreeTextInvoicesByInvoiceDateRangeResult = {
  invoiceNumber: string; // from FreeTextNumber
  company: string; // from dataAreaId
  isPosted: boolean; // true only if IsPosted === 'Yes'
  invoiceDate: string; // ISO string from InvoiceDate
};

// Kept for the required return type alias naming.
export type FreeTextInvoiceHeaderDto = FreeTextInvoicesByInvoiceDateRangeResult;

export type GetFreeTextInvoicesByInvoiceDateRangeResult =
  FreeTextInvoiceHeaderDto[];
