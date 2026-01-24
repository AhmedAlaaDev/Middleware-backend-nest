import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import {
  IPaymentTerm,
  IPaymentTermListFilter,
} from '@/modules/master-data/interfaces/payment-term.interface';

export class GetPaymentTermsQuery extends Query<IPaginatedRes<IPaymentTerm>> {
  constructor(
    public readonly filter?: IPaymentTermListFilter,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
