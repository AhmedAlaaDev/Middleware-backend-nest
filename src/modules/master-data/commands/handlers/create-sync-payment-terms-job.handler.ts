import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { CreateSyncPaymentTermsJobCommand } from '@/modules/master-data/commands/create-sync-payment-terms-job.command';
import { SYNC_TYPES } from '@/modules/master-data/constants/sync-types';
import { ISyncJobResponse } from '@/modules/master-data/interfaces/sync-job.interface';
import { SyncJobRepository } from '@/modules/master-data/repositories/interfaces/sync-job.repository';
import { QUEUES } from '@/modules/queue/constants/queues';
import { MasterDataSyncJobData } from '@/modules/queue/processors/master-data-sync.processor';
import { QueueService } from '@/modules/queue/services/queue.service';

@CommandHandler(CreateSyncPaymentTermsJobCommand)
export class CreateSyncPaymentTermsJobHandler
  implements ICommandHandler<CreateSyncPaymentTermsJobCommand>
{
  private readonly logger = new Logger(CreateSyncPaymentTermsJobHandler.name);

  constructor(
    private readonly syncJobRepository: SyncJobRepository,
    private readonly queueService: QueueService,
  ) {}

  public async execute(
    command: CreateSyncPaymentTermsJobCommand,
  ): Promise<ISyncJobResponse> {
    // Check if there's already a pending or processing job
    const hasActiveJob =
      await this.syncJobRepository.hasPendingOrProcessingJob(
        SYNC_TYPES.PAYMENT_TERMS,
      );
    if (hasActiveJob) {
      throw new HttpException(
        'A sync job for payment terms is already pending or processing',
        HttpStatus.CONFLICT,
      );
    }

    const jobName = `${SYNC_TYPES.PAYMENT_TERMS}-${command.company}-${Date.now()}`;
    const job = await this.syncJobRepository.create(jobName);

    await this.queueService.addJob(
      QUEUES.MASTER_DATA_SYNC,
      'sync-payment-terms',
      {
        jobId: job.id,
        syncType: SYNC_TYPES.PAYMENT_TERMS,
        params: { company: command.company },
      } as MasterDataSyncJobData,
      {
        removeOnComplete: { age: 3600 },
      },
    );

    this.logger.log(`Created sync job for payment terms: ${job.id}`);

    return { jobId: job.id, name: job.name, status: job.status };
  }
}
