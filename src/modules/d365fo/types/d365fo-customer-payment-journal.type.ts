import { EntryAccountType } from '@/common/types';

/**
 * Request data for posting a customer payment journal header to D365FO.
 * Shape intentionally mirrors vendor payment journal headers:
 * dataAreaId, JournalBatchNumber, JournalName, Description.
 */
export interface D365FOCustomerPaymentJournalHeaderRequest {
  dataAreaId: string;
  JournalBatchNumber: string;
  JournalName: string;
  Description: string;
}

/**
 * Response data from posting a customer payment journal header to D365FO.
 */
export interface D365FOCustomerPaymentJournalHeaderResponse {
  '@odata.context'?: string;
  '@odata.etag'?: string;
  dataAreaId: string;
  JournalBatchNumber: string;
  JournalName: string;
  Description: string;
}

/**
 * Request data for posting a customer payment journal line to D365FO.
 * The fields are aligned with the CustomerPaymentJournalLines entity.
 */
export interface D365FOCustomerPaymentJournalLineRequest {
  dataAreaId: string;
  JournalBatchNumber: string;
  LineNumber: number;
  AccountDisplayValue: string;
  AccountType: EntryAccountType;
  PaymentId?: string;
  FinTagDisplayValue?: string;
  OffsetFinTagDisplayValue?: string;
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
  OffsetAccountType: EntryAccountType;
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
  CustomerName?: string;
  OffsetTransactionText?: string;
  MarkedInvoice?: string;
}
