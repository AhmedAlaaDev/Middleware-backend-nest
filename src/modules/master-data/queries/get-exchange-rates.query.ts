import { Query } from '@nestjs/cqrs';

import { IExchangeRate } from '@/modules/master-data/interfaces/exchange-rate.interface';

export class GetExchangeRatesQuery extends Query<IExchangeRate[]> {
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
