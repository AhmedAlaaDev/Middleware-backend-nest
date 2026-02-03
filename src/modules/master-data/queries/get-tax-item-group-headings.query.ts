import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import {
  ITaxItemGroupHeading,
  ITaxItemGroupHeadingListFilter,
} from '@/modules/master-data/interfaces/tax-item-group-heading.interface';

export class GetTaxItemGroupHeadingsQuery extends Query<
  IPaginatedRes<ITaxItemGroupHeading>
> {
  constructor(
    public readonly filter?: ITaxItemGroupHeadingListFilter,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
