import { Query } from '@nestjs/cqrs';

import { ICustomer } from '@/modules/master-data/interfaces/customer.interface';

export class GetCustomersQuery extends Query<ICustomer[]> {
  constructor(
    public readonly company?: string,
    public readonly searchTerm?: string,
  ) {
    super();
  }
}
