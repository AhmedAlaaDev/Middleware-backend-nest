export class ILedger {
  id: string;
  legalEntityId: string;
  accountingCurrency: string;
  reportingCurrency: string;
  name?: string;
  description?: string;
  chartOfAccounts?: string;
  fiscalCalendar?: string;
  reportingCurrencyExchangeRateType?: string;
  budgetExchangeRateType?: string;
  exchangeRateType?: string;
  chartOfAccountsRecId?: number;
  ledgerRecId?: number;
  accountStructureName1?: string;
  accountStructureName2?: string;
  accountStructureName3?: string;
  accountStructureName4?: string;
  accountStructureName5?: string;
  accountStructureName6?: string;
  accountStructureName7?: string;
  accountStructureName8?: string;
  accountStructureName9?: string;
  accountStructureName10?: string;
  accountStructureName11?: string;
  accountStructureName12?: string;
  accountStructureName13?: string;
  accountStructureName14?: string;
  accountStructureName15?: string;
  accountStructureName16?: string;
  accountStructureName17?: string;
  accountStructureName18?: string;
  accountStructureName19?: string;
  accountStructureName20?: string;
  mainAccountIdUnrealizedLoss?: string;
  mainAccountIdRealizedGain?: string;
  mainAccountIdRealizedLoss?: string;
  mainAccountIdFinancialGain?: string;
  mainAccountIdUnrealizedGain?: string;
  mainAccountIdFinancialLoss?: string;
  isBudgetControlEnabled?: string;
  balancingFinancialDimension?: string;
}

export interface ICreateLedger {
  legalEntityId: string;
  accountingCurrency: string;
  reportingCurrency: string;
  name?: string;
  description?: string;
  chartOfAccounts?: string;
  fiscalCalendar?: string;
  reportingCurrencyExchangeRateType?: string;
  budgetExchangeRateType?: string;
  exchangeRateType?: string;
  chartOfAccountsRecId?: number;
  ledgerRecId?: number;
  accountStructureName1?: string;
  accountStructureName2?: string;
  accountStructureName3?: string;
  accountStructureName4?: string;
  accountStructureName5?: string;
  accountStructureName6?: string;
  accountStructureName7?: string;
  accountStructureName8?: string;
  accountStructureName9?: string;
  accountStructureName10?: string;
  accountStructureName11?: string;
  accountStructureName12?: string;
  accountStructureName13?: string;
  accountStructureName14?: string;
  accountStructureName15?: string;
  accountStructureName16?: string;
  accountStructureName17?: string;
  accountStructureName18?: string;
  accountStructureName19?: string;
  accountStructureName20?: string;
  mainAccountIdUnrealizedLoss?: string;
  mainAccountIdRealizedGain?: string;
  mainAccountIdRealizedLoss?: string;
  mainAccountIdFinancialGain?: string;
  mainAccountIdUnrealizedGain?: string;
  mainAccountIdFinancialLoss?: string;
  isBudgetControlEnabled?: string;
  balancingFinancialDimension?: string;
}

export type IUpdateLedger = Partial<ICreateLedger>;

export interface ILedgerListFilter {
  company?: string;
}
