import { Query } from '@nestjs/cqrs';

import { ServiceTypes } from '@/modules/master-data/enums/master-data.enum';
import { IAccountCustomerInvoiceMapping } from '@/modules/master-data/interfaces/account-customer-invoice-mapping.interface';

export class GetAccountMappingsQuery extends Query<
  IAccountCustomerInvoiceMapping[]
> {
  constructor(public readonly serviceType?: ServiceTypes) {
    super();
  }
}
