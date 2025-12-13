import { Command } from '@nestjs/cqrs';

import { ISyncJobResponse } from '@/modules/master-data/interfaces/sync-job.interface';

export class CreateSyncMainAccountsJobCommand extends Command<ISyncJobResponse> {
  constructor(public readonly chartOfAccounts: string) {
    super();
  }
}
