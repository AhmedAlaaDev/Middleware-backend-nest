import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import {
  ILedger,
  ILedgerListFilter,
} from '@/modules/master-data/interfaces/ledger.interface';

export class GetLedgersQuery extends Query<IPaginatedRes<ILedger>> {
  constructor(
    public readonly filter?: ILedgerListFilter,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
