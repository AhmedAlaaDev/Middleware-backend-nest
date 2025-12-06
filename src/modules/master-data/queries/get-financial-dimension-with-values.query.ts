import { Query } from '@nestjs/cqrs';

import {
  IFinancialDimension,
  IFinancialDimensionValue,
} from '@/modules/master-data/interfaces/financial-dimension.interface';

export class GetFinancialDimensionWithValueQuery extends Query<{
  FinancialDimension: IFinancialDimension;
  Values: IFinancialDimensionValue[];
}> {
  constructor(public readonly financialKey?: string) {
    super();
  }
}
