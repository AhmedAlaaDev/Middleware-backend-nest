import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bull';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { redisStore } from 'cache-manager-redis-yet';
import * as redis from 'redis';
import { configuration } from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { DatabaseModule } from './modules/database/database.module';
import { CacheModule as AppCacheModule } from './modules/cache/cache.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { DataBatchesModule } from './modules/data-batches/data-batches.module';
import { AccountReceivableModule } from './modules/account-receivable/account-receivable.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { D365FOModule } from './modules/d365fo/d365fo.module';
import { EntryProcessorsModule } from './modules/entry-processors/entry-processors.module';
import { HealthModule } from './modules/health/health.module';
import { CommonModule } from './common/common.module';
import { RedisClientOptions } from 'redis';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      envFilePath: [
        `.env.${process.env.NODE_ENV || 'development'}.local`,
        `.env.${process.env.NODE_ENV || 'development'}`,
        '.env.local',
        '.env',
      ],
    }),

    // Database - MongoDB
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI', 'mongodb://localhost:27017/d365fomiddleware'),
        maxPoolSize: configService.get<number>('MONGODB_MAX_POOL_SIZE', 10),
      }),
      inject: [ConfigService],
    }),

    // Redis Cache (Distributed Cache)
    CacheModule.registerAsync<RedisClientOptions>({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const redisHost = configService.get<string>('REDIS_HOST', 'localhost');
        const redisPort = configService.get<number>('REDIS_PORT', 6379);
        const redisPassword = configService.get<string>('REDIS_PASSWORD');

        return {
          store: await redisStore({
            socket: {
              host: redisHost,
              port: redisPort,
            },
            password: redisPassword,
          }),
          ttl: configService.get<number>('CACHE_TTL', 300), // 5 minutes default
          max: configService.get<number>('CACHE_MAX_ITEMS', 1000),
        };
      },
      inject: [ConfigService],
    }),

    // Rate Limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        ttl: configService.get<number>('THROTTLE_TTL', 60),
        limit: configService.get<number>('THROTTLE_LIMIT', 100),
      }),
      inject: [ConfigService],
    }),

    // Background Jobs (Bull/BullMQ)
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD'),
        },
        defaultJobOptions: {
          attempts: configService.get<number>('bull.jobAttempts', 3),
          backoff: {
            type: 'exponential',
            delay: configService.get<number>('bull.jobBackoffDelay', 2000),
          },
          removeOnComplete: {
            age: configService.get<number>('bull.removeOnCompleteAge', 3600), // 1 hour
            count: configService.get<number>('bull.removeOnCompleteCount', 1000),
          },
          removeOnFail: {
            age: configService.get<number>('bull.removeOnFailAge', 86400), // 24 hours
          },
        },
      }),
      inject: [ConfigService],
    }),

    // Scheduled Tasks
    ScheduleModule.forRoot(),

    // Event Emitter
    EventEmitterModule.forRoot(),

    // Health Checks
    TerminusModule,

    // Application Modules
    CommonModule,
    DatabaseModule,
    AppCacheModule,
    AuthModule,
    UsersModule,
    MasterDataModule,
    DataBatchesModule,
    AccountReceivableModule,
    LedgerModule,
    D365FOModule,
    EntryProcessorsModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

