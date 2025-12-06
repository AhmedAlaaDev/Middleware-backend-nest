import { Query } from '@nestjs/cqrs';

import { IMainAccount } from '@/modules/master-data/interfaces/main-account.interface';

export class GetMainAccountsQuery extends Query<IMainAccount[]> {
  constructor(public readonly chartOfAccounts?: string) {
    super();
  }
}
