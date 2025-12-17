import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import {
  ICustomer,
  ICustomerListFilter,
} from '@/modules/master-data/interfaces/customer.interface';

export class GetCustomersQuery extends Query<IPaginatedRes<ICustomer>> {
  constructor(
    public readonly filter: ICustomerListFilter,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
