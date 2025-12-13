import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import {
  SYNC_TYPE_LABELS,
  SYNC_TYPES_LIST,
} from '@/modules/master-data/constants/sync-types';
import { SyncStatusDto } from '@/modules/master-data/dtos/sync-status.dto';
import { SyncJobStatus } from '@/modules/master-data/enums/sync-job-status.enum';
import { GetSyncStatusQuery } from '@/modules/master-data/queries/get-sync-status.query';
import { SyncJobRepository } from '@/modules/master-data/repositories/interfaces/sync-job.repository';

@QueryHandler(GetSyncStatusQuery)
export class GetSyncStatusHandler implements IQueryHandler<GetSyncStatusQuery> {
  private readonly logger = new Logger(GetSyncStatusHandler.name);

  constructor(private readonly syncJobRepository: SyncJobRepository) {}

  public async execute(_query: GetSyncStatusQuery): Promise<SyncStatusDto[]> {
    this.logger.log('Fetching sync status for all sync types');

    const statusList: SyncStatusDto[] = [];

    for (const syncType of SYNC_TYPES_LIST) {
      const latestJob =
        await this.syncJobRepository.findLatestBySyncType(syncType);

      statusList.push({
        syncType,
        label: SYNC_TYPE_LABELS[syncType],
        status: latestJob?.status || SyncJobStatus.SUCCESS,
        errorMessage: latestJob?.errorMessage || '',
      });
    }

    return statusList;
  }
}
