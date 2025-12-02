import { Query } from '@nestjs/cqrs';

import { FinancialDimension } from '@/modules/master-data/master-data.service';

export class GetFinancialDimensionsQuery extends Query<FinancialDimension[]> {
  constructor() {
    super();
  }
}

