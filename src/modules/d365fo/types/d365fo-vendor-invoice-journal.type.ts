/**
 * Request data for posting a vendor invoice journal header to D365FO
 */
export interface D365FOVendorInvoiceJournalHeaderRequest {
  dataAreaId: string;
  JournalBatchNumber: string;
  JournalName: string;
  OverrideSalesTax: 'Yes' | 'No';
  Description: string;
  SalesTaxIncluded: 'Yes' | 'No';
}

/**
 * Response data from posting a vendor invoice journal header to D365FO
 */
export interface D365FOVendorInvoiceJournalHeaderResponse {
  '@odata.context'?: string;
  '@odata.etag'?: string;
  dataAreaId: string;
  JournalBatchNumber: string;
  JournalName: string;
  OverrideSalesTax: 'Yes' | 'No';
  Description: string;
  IsPosted: 'Yes' | 'No';
  SalesTaxIncluded: 'Yes' | 'No';
  JournalTotalCredit: number;
  JournalTotalDebit: number;
}

/**
 * Request data for posting a vendor invoice journal line to D365FO
 */
// export interface D365FOVendorInvoiceJournalLineRequest {
//   LineNumber: number;
//   JournalBatchNumber: string;
//   Date: string;
//   DueDate: string;
//   Company: string;
//   AccountType: 'Vend' | 'Ledger';
//   Invoice?: string;
//   Description?: string;
//   Currency: string;
//   Debit: number;
//   Credit: number;
//   OffsetCompany: string;
//   OffsetAccountType: 'Ledger';
//   Company2: string;
//   AccountDisplayValue: string;
//   Approved?: 'Yes' | 'No';
//   DefaultDimensionDisplayValue: string;
//   Document?: string;
//   FinTagDisplayValue?: string;
//   IsWithholdingTaxCalculate?: 'Yes' | 'No';
//   ItemSalesTaxGroup?: string;
//   ItemWithholdingTaxGroupCode?: string;
//   PaymId?: string;
//   SalesTaxGroup?: string;
// }

export interface D365FOVendorInvoiceJournalLineRequest {
  dataAreaId: string;
  JournalBatchNumber: string;
  LineNumber: number;
  AccountDisplayValue: string;
  InvoiceDeclarationId?: string;
  CashDiscountAmount?: number;
  UUID?: string;
  OffsetFinTagDisplayValue?: string;
  PostingProfile: string;
  Listcode?: string;
  OffsetDefaultDimensionDisplayValue: string;
  ReportingCurrencyExchRate?: number;
  PaymId?: string;
  AccountType: 'Vend' | 'Ledger';
  TermsOfPayment?: string;
  RemittanceAddressStreet?: string;
  RemittanceAddressDistrictName?: string;
  ExchRateSecond?: number;
  TransactionType: string;
  ChineseVoucher?: string;
  Tax1099Fields?: number;
  MethodOfPayment?: string;
  ChineseVoucherType?: string;
  AssetId?: string;
  RemittanceAddressCity?: string;
  ExchRate: number;
  Document?: string;
  Description?: string;
  RemittanceAddressState?: string;
  RemittanceAddressZipCode?: string;
  Invoice?: string;
  DeliveryDate?: string;
  OverrideSalesTax_BR?: 'Yes' | 'No';
  RemittanceAddressCounty?: string;
  Date: string;
  RemittanceAddressLocationId?: string;
  Voucher?: string;
  ApproverNumber?: string;
  Approved?: 'Yes' | 'No';
  CashDiscount?: string;
  TaxExemptNumber?: string;
  Currency: string;
  ItemWithholdingTaxGroupCode?: string;
  OffsetAccountType: string;
  InvoiceDate: string;
  BankAccountId?: string;
  RemittanceAddressCountryISOCode?: string;
  CashDiscountDate?: string;
  Debit: number;
  ImportedSalesTax?: number;
  OffsetCompany: string;
  TaxGroup_BR?: string;
  DueDate: string;
  OverrideSalesTax: 'Yes' | 'No';
  RemittanceAddressTimeZone?: string | null;
  RemittanceAddressDescription?: string;
  Credit: number;
  GSTHSTTaxType?: string;
  AssetTransType?: string;
  TaxItemGroup_BR?: string;
  Company: string;
  RemittanceAddressValidFrom?: string;
  CustVendBankAccountId?: string;
  IsWithholdingTaxCalculate?: 'Yes' | 'No';
  RemittanceAddressValidTo?: string;
  OffsetAccountDisplayValue: string;
  SalesTaxGroup?: string;
  DefaultDimensionDisplayValue: string;
  RemittanceAddressLatitude?: number;
  SalesTaxCode?: string;
  ItemSalesTaxGroup?: string;
  RemittanceAddressCountry?: string;
  FinTagDisplayValue?: string;
  OffsetTransactionText?: string;
  TypeOfOperation?: string;
  BookId?: string;
  PaymentSpecification?: string;
  RemittanceAddressLongitude?: number;
  ITMCostTypeId?: string;
  ITMCostArea?: string;
}
