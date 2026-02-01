/**
 * Request payload for creating a Ledger Journal Header (POST LedgerJournalHeaders)
 */
export interface LedgerJournalHeaderRequest {
  dataAreaId?: string;
  JournalName: string;
  Description: string;
}

/**
 * Request payload for creating a Ledger Journal Line (POST LedgerJournalLines)
 */
export interface LedgerJournalLineRequest {
  dataAreaId?: string;
  JournalBatchNumber: string;
  CurrencyCode?: string;
  TransDate?: string | Date;
  DocumentDate?: string | Date;
  DueDate?: string | Date;
  AccountType?: string;
  AccountDisplayValue?: string;
  DefaultDimensionDisplayValue?: string;
  Text?: string;
  DebitAmount?: number;
  CreditAmount?: number;
  OffsetAccountType?: string;
  OffsetAccountDisplayValue?: string;
  OffsetDefaultDimensionDisplayValue?: string;
  OffsetText?: string;
  Voucher?: string;
  Document?: string;
  Invoice?: string;
  PostingProfile?: string;
  PaymentMethod?: string;
  SalesTaxGroup?: string;
  ItemSalesTaxGroup?: string;
  ExchRate?: number;
}

/**
 * D365 response from POST LedgerJournalHeaders (use JournalBatchNumber for posting lines)
 */
export interface LedgerJournalHeaderResponse {
  '@odata.etag'?: string;
  dataAreaId: string;
  JournalBatchNumber: string;
  AccountingCurrency?: string;
  JournalName?: string;
  IntegrationKey?: string;
  Description?: string;
  PostingLayer?: string;
  IsPosted?: string;
  JournalTotalCredit?: number;
  JournalTotalDebit?: number;
}

/**
 * D365 response from POST LedgerJournalLines
 */
export interface LedgerJournalLineResponse {
  '@odata.etag'?: string;
  dataAreaId: string;
  JournalBatchNumber: string;
  LineNumber?: number;
  TransDate?: string;
  DebitAmount?: number;
  CreditAmount?: number;
  AccountDisplayValue?: string;
  AccountType?: string;
  CurrencyCode?: string;
  Voucher?: string;
  Text?: string;
  DefaultDimensionDisplayValue?: string;
  DocumentDate?: string;
  DueDate?: string;
}

/**
 * Represents a Ledger from D365FO's Ledgers entity
 */
export interface D365FOLedger {
  '@odata.etag'?: string;
  LegalEntityId: string;
  AccountingCurrency: string;
  ReportingCurrency: string;
  Name?: string;
  Description?: string;
  ChartOfAccounts?: string;
  FiscalCalendar?: string;
  ReportingCurrencyExchangeRateType?: string;
  BudgetExchangeRateType?: string;
  ExchangeRateType?: string;
  ChartOfAccountsRecId?: number;
  LedgerRecId?: number;
  AccountStructureName1?: string;
  AccountStructureName2?: string;
  AccountStructureName3?: string;
  AccountStructureName4?: string;
  AccountStructureName5?: string;
  AccountStructureName6?: string;
  AccountStructureName7?: string;
  AccountStructureName8?: string;
  AccountStructureName9?: string;
  AccountStructureName10?: string;
  AccountStructureName11?: string;
  AccountStructureName12?: string;
  AccountStructureName13?: string;
  AccountStructureName14?: string;
  AccountStructureName15?: string;
  AccountStructureName16?: string;
  AccountStructureName17?: string;
  AccountStructureName18?: string;
  AccountStructureName19?: string;
  AccountStructureName20?: string;
  MainAccountIdUnrealizedLoss?: string;
  MainAccountIdRealizedGain?: string;
  MainAccountIdRealizedLoss?: string;
  MainAccountIdFinancialGain?: string;
  MainAccountIdUnrealizedGain?: string;
  MainAccountIdFinancialLoss?: string;
  IsBudgetControlEnabled?: string;
  BalancingFinancialDimension?: string;
}
