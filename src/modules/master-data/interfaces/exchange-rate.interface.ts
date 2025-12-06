export class IExchangeRate {
  id: string;
  rateTypeName: string;
  fromCurrency: string;
  toCurrency: string;
  startDate: string;
  rate: number;
  endDate: string;
  conversionFactor?: string;
  rateTypeDescription?: string;
}

export interface ICreateExchangeRate {
  rateTypeName: string;
  fromCurrency: string;
  toCurrency: string;
  startDate: Date;
  rate: number;
  endDate: Date;
  conversionFactor?: string;
  rateTypeDescription?: string;
}

export type IUpdateExchangeRate = Partial<ICreateExchangeRate>;

export interface IExchangeRateListFilter {
  rateTypeName?: string;
  fromCurrency?: string;
  toCurrency?: string;
  fromDate?: Date;
  toDate?: Date;
}
