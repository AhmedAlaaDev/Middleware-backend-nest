import { Query } from '@nestjs/cqrs';
import { AccountCustomerInvoiceMapping, ServiceTypes } from '@/modules/master-data/types/master-data.types';

export class GetAccountMappingsQuery extends Query<AccountCustomerInvoiceMapping[]> {
  constructor(public readonly serviceType?: ServiceTypes) {
    super();
  }
}

