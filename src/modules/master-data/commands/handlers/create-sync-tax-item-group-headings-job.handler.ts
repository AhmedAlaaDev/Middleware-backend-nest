import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { CreateSyncTaxItemGroupHeadingsJobCommand } from '@/modules/master-data/commands/create-sync-tax-item-group-headings-job.command';
import { SYNC_TYPES } from '@/modules/master-data/constants/sync-types';
import { ISyncJobResponse } from '@/modules/master-data/interfaces/sync-job.interface';
import { SyncJobRepository } from '@/modules/master-data/repositories/interfaces/sync-job.repository';
import { QUEUES } from '@/modules/queue/constants/queues';
import { MasterDataSyncJobData } from '@/modules/queue/processors/master-data-sync.processor';
import { QueueService } from '@/modules/queue/services/queue.service';

@CommandHandler(CreateSyncTaxItemGroupHeadingsJobCommand)
export class CreateSyncTaxItemGroupHeadingsJobHandler implements ICommandHandler<CreateSyncTaxItemGroupHeadingsJobCommand> {
  private readonly logger = new Logger(
    CreateSyncTaxItemGroupHeadingsJobHandler.name,
  );

  constructor(
    private readonly syncJobRepository: SyncJobRepository,
    private readonly queueService: QueueService,
  ) {}

  public async execute(
    command: CreateSyncTaxItemGroupHeadingsJobCommand,
  ): Promise<ISyncJobResponse> {
    const hasActiveJob = await this.syncJobRepository.hasPendingOrProcessingJob(
      SYNC_TYPES.TAX_ITEM_GROUP_HEADINGS,
    );
    if (hasActiveJob) {
      throw new HttpException(
        'A sync job for tax item group headings is already pending or processing',
        HttpStatus.CONFLICT,
      );
    }

    const jobName = `${SYNC_TYPES.TAX_ITEM_GROUP_HEADINGS}-${command.company}-${Date.now()}`;
    const job = await this.syncJobRepository.create(jobName);

    await this.queueService.addJob(
      QUEUES.MASTER_DATA_SYNC,
      'sync-tax-item-group-headings',
      {
        jobId: job.id,
        syncType: SYNC_TYPES.TAX_ITEM_GROUP_HEADINGS,
        params: { company: command.company },
      } as MasterDataSyncJobData,
      { removeOnComplete: { age: 3600 } },
    );

    this.logger.log(`Created sync job for tax item group headings: ${job.id}`);
    return { jobId: job.id, name: job.name, status: job.status };
  }
}
