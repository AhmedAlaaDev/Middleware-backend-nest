import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { ISyncJob } from '@/modules/master-data/interfaces/sync-job.interface';
import { GetSyncJobsQuery } from '@/modules/master-data/queries/get-sync-jobs.query';
import { SyncJobRepository } from '@/modules/master-data/repositories/interfaces/sync-job.repository';

@QueryHandler(GetSyncJobsQuery)
export class GetSyncJobsHandler implements IQueryHandler<GetSyncJobsQuery> {
  private readonly logger = new Logger(GetSyncJobsHandler.name);

  constructor(private readonly syncJobRepository: SyncJobRepository) {}

  public async execute(_query: GetSyncJobsQuery): Promise<ISyncJob[]> {
    this.logger.log('Fetching all sync jobs from database');

    return this.syncJobRepository.getList();
  }
}
