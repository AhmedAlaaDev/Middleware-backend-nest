import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { Job } from 'bullmq';

import {
  SyncBillingDataCommand,
  SyncCustomersCommand,
  SyncExchangeRatesCommand,
  SyncFinancialDimensionsCommand,
  SyncLedgersCommand,
  SyncMainAccountsCommand,
  SyncPaymentTermsCommand,
  SyncVendorsCommand,
} from '@/modules/master-data/commands';
import { SYNC_TYPES } from '@/modules/master-data/constants/sync-types';
import { SyncJobStatus } from '@/modules/master-data/enums';
import { SyncJobRepository } from '@/modules/master-data/repositories/interfaces';
import { QUEUES } from '@/modules/queue/constants/queues';

export interface MasterDataSyncJobData {
  jobId: string;
  syncType: string;
  params: Record<string, any>;
}

@Processor(QUEUES.MASTER_DATA_SYNC, {
  concurrency: 1, // Process 1 job at a time to respect resource limits
})
export class MasterDataSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MasterDataSyncProcessor.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly syncJobRepository: SyncJobRepository,
  ) {
    super();
  }

  public async process(job: Job<MasterDataSyncJobData>): Promise<void> {
    this.logger.log(
      `Processing master data sync job ${job.id} for jobId: ${job.data.jobId}`,
    );

    try {
      // Update status to processing
      await this.syncJobRepository.updateStatus(
        job.data.jobId,
        SyncJobStatus.PROCESSING,
      );

      // Execute the appropriate sync command
      await this.executeSyncCommand(job.data.syncType, job.data.params);

      // Update status to success
      await this.syncJobRepository.updateStatus(
        job.data.jobId,
        SyncJobStatus.SUCCESS,
      );

      this.logger.log(`Master data sync job ${job.id} completed successfully`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Master data sync job ${job.id} failed: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Update status to failed
      await this.syncJobRepository.updateStatus(
        job.data.jobId,
        SyncJobStatus.FAILED,
        errorMessage,
      );

      throw error;
    }
  }

  private async executeSyncCommand(
    syncType: string,
    params: Record<string, any>,
  ): Promise<void> {
    switch (syncType) {
      case SYNC_TYPES.CUSTOMERS:
        await this.commandBus.execute(new SyncCustomersCommand(params.company));
        break;

      case SYNC_TYPES.FINANCIAL_DIMENSIONS:
        await this.commandBus.execute(
          new SyncFinancialDimensionsCommand(params.company),
        );
        break;

      case SYNC_TYPES.BILLING_DATA:
        await this.commandBus.execute(
          new SyncBillingDataCommand(params.company),
        );
        break;

      case SYNC_TYPES.MAIN_ACCOUNTS:
        await this.commandBus.execute(
          new SyncMainAccountsCommand(params.chartOfAccounts),
        );
        break;

      case SYNC_TYPES.VENDORS:
        await this.commandBus.execute(new SyncVendorsCommand(params.company));
        break;

      case SYNC_TYPES.EXCHANGE_RATES:
        await this.commandBus.execute(
          new SyncExchangeRatesCommand(params.company, params.rateType),
        );
        break;

      case SYNC_TYPES.PAYMENT_TERMS:
        await this.commandBus.execute(
          new SyncPaymentTermsCommand(params.company),
        );
        break;

      case SYNC_TYPES.LEDGERS:
        await this.commandBus.execute(new SyncLedgersCommand(params.company));
        break;

      default:
        throw new Error(`Unknown sync type: ${syncType}`);
    }
  }
}
