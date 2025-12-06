import { Query } from '@nestjs/cqrs';

import { IFinancialDimension } from '@/modules/master-data/interfaces/financial-dimension.interface';

export class GetFinancialDimensionsQuery extends Query<IFinancialDimension[]> {
  constructor() {
    super();
  }
}
