import { BullModule } from '@nestjs/bullmq';
import { Global, Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { IConfig, RedisConfig } from '@/config';
import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { MasterDataModule } from '@/modules/master-data/master-data.module';
import { AdminQueuesController } from '@/modules/queue/admin-queues.controller';
import { QUEUES } from '@/modules/queue/constants/queues';
import { DataBatchReprocessProcessor } from '@/modules/queue/processors/data-batch-reprocess.processor';
import { MasterDataSyncProcessor } from '@/modules/queue/processors/master-data-sync.processor';
import { PostCustomerPaymentJournalDFOProcessor } from '@/modules/queue/processors/post-customer-payment-journal-dfo.processor';
import { PostFreeTextInvoiceDFOProcessor } from '@/modules/queue/processors/post-free-text-invoice-dfo.processor';
import { PostLedgerJournalDFOProcessor } from '@/modules/queue/processors/post-ledger-journal-dfo.processor';
import { PostVendorJournalDFOProcessor } from '@/modules/queue/processors/post-vendor-journal-dfo.processor';
import {
  QueueJobGroup,
  QueueJobGroupSchema,
} from '@/modules/queue/schemas/queue-job-group.schema';
import {
  QueueJob,
  QueueJobSchema,
} from '@/modules/queue/schemas/queue-job.schema';
import { DfoRollbackService } from '@/modules/queue/services/dfo-rollback.service';
import { QueueEventsMonitorService } from '@/modules/queue/services/queue-events-monitor.service';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';
import { QueueRecoveryService } from '@/modules/queue/services/queue-recovery.service';
import { QueueService } from '@/modules/queue/services/queue.service';
import { CustomerPaymentJournalPostingStrategy } from '@/modules/queue/strategies/customer-payment-journal-posting.strategy';
import { FreeTextInvoicePostingStrategy } from '@/modules/queue/strategies/free-text-invoice-posting.strategy';
import { LedgerJournalPostingStrategy } from '@/modules/queue/strategies/ledger-journal-posting.strategy';
import { VendorJournalPostingStrategy } from '@/modules/queue/strategies/vendor-journal-posting.strategy';
import { VendorPaymentJournalPostingStrategy } from '@/modules/queue/strategies/vendor-payment-journal-posting.strategy';

const processors = [
  PostFreeTextInvoiceDFOProcessor,
  PostVendorJournalDFOProcessor,
  PostLedgerJournalDFOProcessor,
  PostCustomerPaymentJournalDFOProcessor,
  MasterDataSyncProcessor,
  DataBatchReprocessProcessor,
];
const strategies = [
  FreeTextInvoicePostingStrategy,
  VendorJournalPostingStrategy,
  VendorPaymentJournalPostingStrategy,
  CustomerPaymentJournalPostingStrategy,
  LedgerJournalPostingStrategy,
];
const queueServices = [
  DfoRollbackService,
  QueueService,
  QueueJobStoreService,
  QueueRecoveryService,
  QueueEventsMonitorService,
];

@Global()
@Module({
  imports: [
    forwardRef(() => MasterDataModule),
    forwardRef(() => DataBatchModule),
    forwardRef(() => D365FOModule),
    MongooseModule.forFeature([
      { name: QueueJob.name, schema: QueueJobSchema },
      { name: QueueJobGroup.name, schema: QueueJobGroupSchema },
    ]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<IConfig>) => {
        const redis = configService.get<RedisConfig>('redis');

        const connection: Record<string, unknown> = {
          host: redis?.host ?? 'localhost',
          port: redis?.port ?? 6379,
          db: redis?.db ?? 0,
          // BullMQ requires maxRetriesPerRequest to be null
          maxRetriesPerRequest: null,
          enableReadyCheck: redis?.enableReadyCheck ?? true,
          lazyConnect: redis?.lazyConnect ?? false,
        };

        // Only add password if it's provided
        if (redis?.password) {
          connection.password = redis.password;
        }

        return { connection };
      },
    }),

    // Register queues
    BullModule.registerQueue(
      ...Object.values(QUEUES).map((queue) => ({ name: queue })),
    ),
  ],
  providers: [...processors, ...strategies, ...queueServices],
  controllers: [AdminQueuesController],
  exports: [QueueService, QueueJobStoreService],
})
export class QueueModule {}
