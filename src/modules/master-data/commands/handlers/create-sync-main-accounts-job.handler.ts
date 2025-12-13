import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { CreateSyncMainAccountsJobCommand } from '@/modules/master-data/commands/create-sync-main-accounts-job.command';
import { SYNC_TYPES } from '@/modules/master-data/constants/sync-types';
import { ISyncJobResponse } from '@/modules/master-data/interfaces/sync-job.interface';
import { SyncJobRepository } from '@/modules/master-data/repositories/interfaces/sync-job.repository';
import { QUEUES } from '@/modules/queue/constants/queues';
import { MasterDataSyncJobData } from '@/modules/queue/processors/master-data-sync.processor';
import { QueueService } from '@/modules/queue/services/queue.service';

@CommandHandler(CreateSyncMainAccountsJobCommand)
export class CreateSyncMainAccountsJobHandler implements ICommandHandler<CreateSyncMainAccountsJobCommand> {
  private readonly logger = new Logger(CreateSyncMainAccountsJobHandler.name);

  constructor(
    private readonly syncJobRepository: SyncJobRepository,
    private readonly queueService: QueueService,
  ) {}

  public async execute(
    command: CreateSyncMainAccountsJobCommand,
  ): Promise<ISyncJobResponse> {
    // Check if there's already a pending or processing job
    const hasActiveJob = await this.syncJobRepository.hasPendingOrProcessingJob(
      SYNC_TYPES.MAIN_ACCOUNTS,
    );
    if (hasActiveJob) {
      throw new HttpException(
        'A sync job for main accounts is already pending or processing',
        HttpStatus.CONFLICT,
      );
    }

    const jobName = `${SYNC_TYPES.MAIN_ACCOUNTS}-${command.chartOfAccounts}-${Date.now()}`;
    const job = await this.syncJobRepository.create(jobName);

    await this.queueService.addJob(
      QUEUES.MASTER_DATA_SYNC,
      'sync-main-accounts',
      {
        jobId: job.id,
        syncType: SYNC_TYPES.MAIN_ACCOUNTS,
        params: { chartOfAccounts: command.chartOfAccounts },
      } as MasterDataSyncJobData,
      {
        removeOnComplete: { age: 3600 },
      },
    );

    this.logger.log(`Created sync job for main accounts: ${job.id}`);

    return { jobId: job.id, name: job.name, status: job.status };
  }
}
