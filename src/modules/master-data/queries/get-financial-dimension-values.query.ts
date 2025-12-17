import { Query } from '@nestjs/cqrs';

import {
  IFinancialDimensionValue,
  IGetFinancialDimensionValueFilter,
} from '@/modules/master-data/interfaces/financial-dimension.interface';

export class GetFinancialDimensionValueQuery extends Query<
  IFinancialDimensionValue[]
> {
  constructor(
    public readonly financialKey?: string,
    public readonly filter?: IGetFinancialDimensionValueFilter,
  ) {
    super();
  }
}
