import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import {
  IBillingClassification,
  IBillingClassificationListFilter,
} from '@/modules/master-data/interfaces/billing-classification.interface';

export class GetBillingClassificationsQuery extends Query<
  IPaginatedRes<IBillingClassification>
> {
  constructor(
    public readonly filter: IBillingClassificationListFilter,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
