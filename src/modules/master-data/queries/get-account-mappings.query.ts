import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import {
  IAccountCustomerInvoiceMapping,
  IAccountCustomerInvoiceMappingFilter,
} from '@/modules/master-data/interfaces/account-customer-invoice-mapping.interface';

export class GetAccountMappingsQuery extends Query<
  IPaginatedRes<IAccountCustomerInvoiceMapping>
> {
  constructor(
    public readonly filter: IAccountCustomerInvoiceMappingFilter,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
