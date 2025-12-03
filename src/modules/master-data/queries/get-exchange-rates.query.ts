import { Query } from '@nestjs/cqrs';

export interface ExchangeRate {
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

export class GetExchangeRatesQuery extends Query<ExchangeRate[]> {
  constructor(
    public readonly rateType?: string,
    public readonly fromCurrency?: string,
    public readonly toCurrency?: string,
    public readonly fromDate?: Date,
    public readonly toDate?: Date,
  ) {
    super();
  }
}
