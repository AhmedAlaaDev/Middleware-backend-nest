import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import {
  IMainAccount,
  IMainAccountListFilter,
} from '@/modules/master-data/interfaces/main-account.interface';

export class GetMainAccountsQuery extends Query<IPaginatedRes<IMainAccount>> {
  constructor(
    public readonly filter: IMainAccountListFilter,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
