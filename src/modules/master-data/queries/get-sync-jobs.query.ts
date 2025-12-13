import { Query } from '@nestjs/cqrs';

import { ISyncJob } from '@/modules/master-data/interfaces/sync-job.interface';

export class GetSyncJobsQuery extends Query<ISyncJob[]> {
  constructor() {
    super();
  }
}
