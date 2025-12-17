import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import {
  IBillingCode,
  IBillingCodeListFilter,
} from '@/modules/master-data/interfaces/billing-code.interface';

export class GetBillingCodesQuery extends Query<IPaginatedRes<IBillingCode>> {
  constructor(
    public readonly filter: IBillingCodeListFilter,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
