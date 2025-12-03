/**
 * Represents a Main Account from D365FO's MainAccounts entity.
 */
export interface D365FOMainAccount {
  '@odata.etag'?: string;
  ChartOfAccounts: string;
  MainAccountId: string;
  MainAccountRecId: number;
  SRUCode?: string;
  MainAccountType: string;
  Name?: string;
  ReportingExchangeAdjustmentRateType?: string;
  User?: string;
  Closing?: string;
  AccountCategoryDescription?: string;
  ForeignCurrencyRevaluation?: 'Yes' | 'No';
  InflationAdjustment?: 'Yes' | 'No';
  OffsetAccountDisplayValue?: string;
  ParentMainAccountId?: string;
  FinancialReportingCurrencyTranslationType?: string;
  DefaultCurrency?: string;
  DebitCreditDefault?: string;
  ActiveTo?: string; // ISO 8601 date string
  MandatoryPaymentReference?: 'Yes' | 'No';
  Monetary?: 'Yes' | 'No';
  BalanceControl?: string;
  OpeningAccountId?: string;
  ValidatePostingType?: string;
  RepomoType?: string;
  ExchangeAdjustmentRateType?: string;
  IsSuspended?: 'Yes' | 'No';
  AdjustmentMethod?: string;
  PostingType?: string;
  ChartOfAccountsRecId?: number;
  ValidateCurrency?: string;
  MainAccountCategory?: string;
  ReportingAccountType?: string;
  FinancialReportingExchangeRateType?: string;
  DefaultConsolidationAccount?: string;
  DoNotAllowManualEntry?: 'Yes' | 'No';
  DebitCreditRequirement?: string;
  ValidateUser?: string;
  ActiveFrom?: string; // ISO 8601 date string
  NatureCode_BR?: string;
}
