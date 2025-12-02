import { Query } from '@nestjs/cqrs';
import { D365FOCustomer } from '@/modules/d365fo/types';

export class GetCustomersQuery extends Query<D365FOCustomer[]> {
  constructor(
    public readonly company: string,
    public readonly skipCount: number = 0,
    public readonly maxCount: number = 50,
    public readonly searchTerm?: string,
  ) {
    super();
  }
}

