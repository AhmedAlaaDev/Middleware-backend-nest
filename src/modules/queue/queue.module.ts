import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { redisConfig } from '@/config';
import { ExampleProcessor } from './processors/example.processor';
import { QueueController } from './queue.controller';
import { QueueService } from './services/queue.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<ReturnType<typeof redisConfig>>('redis');
        return {
          connection: {
            host: redis?.host ?? 'localhost',
            port: redis?.port ?? 6379,
            password: redis?.password,
            db: redis?.db ?? 0,
            maxRetriesPerRequest: redis?.maxRetriesPerRequest ?? 3,
            enableReadyCheck: redis?.enableReadyCheck ?? true,
            lazyConnect: redis?.lazyConnect ?? false,
          },
        };
      },
    }),
    // Register queues
    BullModule.registerQueue({
      name: 'example-queue',
    }),
  ],
  controllers: [QueueController],
  providers: [ExampleProcessor, QueueService],
  exports: [BullModule, QueueService],
})
export class QueueModule {}
