import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { CreateSyncBillingDataJobCommand } from '@/modules/master-data/commands/create-sync-billing-data-job.command';
import { SYNC_TYPES } from '@/modules/master-data/constants/sync-types';
import { ISyncJobResponse } from '@/modules/master-data/interfaces/sync-job.interface';
import { SyncJobRepository } from '@/modules/master-data/repositories/interfaces/sync-job.repository';
import { QUEUES } from '@/modules/queue/constants/queues';
import { MasterDataSyncJobData } from '@/modules/queue/processors/master-data-sync.processor';
import { QueueService } from '@/modules/queue/services/queue.service';

@CommandHandler(CreateSyncBillingDataJobCommand)
export class CreateSyncBillingDataJobHandler implements ICommandHandler<CreateSyncBillingDataJobCommand> {
  private readonly logger = new Logger(CreateSyncBillingDataJobHandler.name);

  constructor(
    private readonly syncJobRepository: SyncJobRepository,
    private readonly queueService: QueueService,
  ) {}

  public async execute(
    command: CreateSyncBillingDataJobCommand,
  ): Promise<ISyncJobResponse> {
    // Check if there's already a pending or processing job
    const hasActiveJob = await this.syncJobRepository.hasPendingOrProcessingJob(
      SYNC_TYPES.BILLING_DATA,
    );
    if (hasActiveJob) {
      throw new HttpException(
        'A sync job for billing data is already pending or processing',
        HttpStatus.CONFLICT,
      );
    }

    const jobName = `${SYNC_TYPES.BILLING_DATA}-${command.company}-${Date.now()}`;
    const job = await this.syncJobRepository.create(jobName);

    await this.queueService.addJob(
      QUEUES.MASTER_DATA_SYNC,
      'sync-billing-data',
      {
        jobId: job.id,
        syncType: SYNC_TYPES.BILLING_DATA,
        params: { company: command.company },
      } as MasterDataSyncJobData,
      {
        removeOnComplete: { age: 3600 },
      },
    );

    this.logger.log(`Created sync job for billing data: ${job.id}`);

    return { jobId: job.id, name: job.name, status: job.status };
  }
}
