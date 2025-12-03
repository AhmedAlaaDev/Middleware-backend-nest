import { Command } from '@nestjs/cqrs';

export class SyncMainAccountsCommand extends Command<{
  accountsCreated: number;
  accountsUpdated: number;
}> {
  constructor(public readonly chartOfAccounts: string) {
    super();
  }
}
