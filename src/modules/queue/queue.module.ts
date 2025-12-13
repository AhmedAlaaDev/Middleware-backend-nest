import { BullModule } from '@nestjs/bullmq';
import { Global, Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IConfig, RedisConfig } from '@/config';
import { MasterDataModule } from '@/modules/master-data/master-data.module';
import { QUEUES } from '@/modules/queue/constants/queues';
import { MasterDataSyncProcessor } from '@/modules/queue/processors/master-data-sync.processor';
import { PostBatchDFOProcessor } from '@/modules/queue/processors/post-batch-dfo.processor';
import { QueueService } from '@/modules/queue/services/queue.service';

const processors = [PostBatchDFOProcessor, MasterDataSyncProcessor];

@Global()
@Module({
  imports: [
    forwardRef(() => MasterDataModule),
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
  providers: [...processors, QueueService],
  exports: [QueueService],
})
export class QueueModule {}
