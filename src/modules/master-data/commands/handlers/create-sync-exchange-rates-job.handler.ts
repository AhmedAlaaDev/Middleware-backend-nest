import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { CreateSyncExchangeRatesJobCommand } from '@/modules/master-data/commands/create-sync-exchange-rates-job.command';
import { SYNC_TYPES } from '@/modules/master-data/constants/sync-types';
import { ISyncJobResponse } from '@/modules/master-data/interfaces/sync-job.interface';
import { SyncJobRepository } from '@/modules/master-data/repositories/interfaces/sync-job.repository';
import { QUEUES } from '@/modules/queue/constants/queues';
import { MasterDataSyncJobData } from '@/modules/queue/processors/master-data-sync.processor';
import { QueueService } from '@/modules/queue/services/queue.service';

@CommandHandler(CreateSyncExchangeRatesJobCommand)
export class CreateSyncExchangeRatesJobHandler implements ICommandHandler<CreateSyncExchangeRatesJobCommand> {
  private readonly logger = new Logger(CreateSyncExchangeRatesJobHandler.name);

  constructor(
    private readonly syncJobRepository: SyncJobRepository,
    private readonly queueService: QueueService,
  ) {}

  public async execute(
    command: CreateSyncExchangeRatesJobCommand,
  ): Promise<ISyncJobResponse> {
    // Check if there's already a pending or processing job
    const hasActiveJob = await this.syncJobRepository.hasPendingOrProcessingJob(
      SYNC_TYPES.EXCHANGE_RATES,
    );
    if (hasActiveJob) {
      throw new HttpException(
        'A sync job for exchange rates is already pending or processing',
        HttpStatus.CONFLICT,
      );
    }

    const rateTypePart = command.rateType || 'all';
    const jobName = `${SYNC_TYPES.EXCHANGE_RATES}-${command.company}-${rateTypePart}-${Date.now()}`;
    const job = await this.syncJobRepository.create(jobName);

    await this.queueService.addJob(
      QUEUES.MASTER_DATA_SYNC,
      'sync-exchange-rates',
      {
        jobId: job.id,
        syncType: SYNC_TYPES.EXCHANGE_RATES,
        params: { company: command.company, rateType: command.rateType },
      } as MasterDataSyncJobData,
      {
        removeOnComplete: { age: 3600 },
      },
    );

    this.logger.log(`Created sync job for exchange rates: ${job.id}`);

    return { jobId: job.id, name: job.name, status: job.status };
  }
}
