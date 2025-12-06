import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { IFinancialDimension } from '@/modules/master-data/interfaces/financial-dimension.interface';

export class GetFinancialDimensionsQuery extends Query<
  IPaginatedRes<IFinancialDimension>
> {
  constructor(
    public readonly maxCount?: number,
    public readonly skipCount?: number,
  ) {
    super();
  }
}
