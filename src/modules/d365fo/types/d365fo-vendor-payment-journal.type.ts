/**
 * Request data for posting a vendor payment journal header to D365FO.
 * Same shape as vendor invoice journal header.
 */
export interface D365FOVendorPaymentJournalHeaderRequest {
  dataAreaId: string;
  JournalBatchNumber: string;
  JournalName: string;
  Description: string;
}

/**
 * Response data from posting a vendor payment journal header to D365FO
 */
export interface D365FOVendorPaymentJournalHeaderResponse {
  '@odata.context'?: string;
  '@odata.etag'?: string;
  dataAreaId: string;
  JournalBatchNumber: string;
  JournalName: string;
  Description: string;
}

/**
 * Request data for posting a vendor payment journal line to D365FO.
 * Key set from VendorPaymentJournalLines entity (CreditAmount/DebitAmount, TransactionDate, etc.)
 */
export interface D365FOVendorPaymentJournalLineRequest {
  dataAreaId: string;
  JournalBatchNumber: string;
  LineNumber: number;
  AccountDisplayValue: string;
  AccountType: 'Vend' | 'Ledger';
  PaymentId?: string;
  OffsetFinTagDisplayValue?: string;
  FinTagDisplayValue?: string;
  TransactionDate: string;
  PostingProfile: string;
  ReportingCurrencyExchRate?: number;
  ReportingCurrencyExchRateSecondary?: number;
  TransactionText?: string;
  CurrencyCode: string;
  ExchangeRate: number;
  CreditAmount: number;
  DebitAmount: number;
  Voucher?: string;
  DefaultDimensionsForAccountDisplayValue?: string;
  DefaultDimensionsForOffsetAccountDisplayValue?: string;
  OffsetAccountType: string;
  OffsetAccountDisplayValue: string;
  Company: string;
  OffsetCompany: string;
  RemittanceAddressDescription?: string;
  RemittanceAddressCountryISOCode?: string;
  RemittanceLocationId?: string;
  RemittanceAddressValidFrom?: string;
  RemittanceAddressValidTo?: string;
  RemittanceAddressCountry?: string;
  FullPrimaryRemittanceAddress?: string;
  SettleVoucher?: string;
  VendorName?: string;
  OffsetTransactionText?: string;
  MarkedInvoice?: string;
}
