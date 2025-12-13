import { Command } from '@nestjs/cqrs';

import { ISyncJobResponse } from '@/modules/master-data/interfaces/sync-job.interface';

export class CreateSyncExchangeRatesJobCommand extends Command<ISyncJobResponse> {
  constructor(
    public readonly company: string,
    public readonly rateType?: string,
  ) {
    super();
  }
}
