import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import {
  IExchangeRate,
  IExchangeRateListFilter,
} from '@/modules/master-data/interfaces/exchange-rate.interface';

export class GetExchangeRatesQuery extends Query<IPaginatedRes<IExchangeRate>> {
  constructor(
    public readonly filter: IExchangeRateListFilter,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
