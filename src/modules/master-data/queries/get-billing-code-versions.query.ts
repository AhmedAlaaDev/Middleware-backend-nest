import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import {
  IBillingCodeVersion,
  IBillingCodeVersionListFilter,
} from '@/modules/master-data/interfaces/billing-code-version.interface';

export class GetBillingCodeVersionsQuery extends Query<
  IPaginatedRes<IBillingCodeVersion>
> {
  constructor(
    public readonly filter: IBillingCodeVersionListFilter,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
