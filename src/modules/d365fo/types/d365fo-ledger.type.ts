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
