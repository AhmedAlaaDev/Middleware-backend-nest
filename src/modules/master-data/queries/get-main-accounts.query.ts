import { Query } from '@nestjs/cqrs';

export interface MainAccount {
  id: string;
  chartNumber: string;
  accountNumber: string;
}

export class GetMainAccountsQuery extends Query<MainAccount[]> {
  constructor(public readonly chartOfAccounts?: string) {
    super();
  }
}

