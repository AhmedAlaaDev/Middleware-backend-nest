import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';

import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { IConfig, ObservabilityConfig } from '@/config';
import { AdminLogsController } from '@/modules/observability/admin-logs.controller';
import { RequestLoggingInterceptor } from '@/modules/observability/interceptors/request-logging.interceptor';
import { TraceContextMiddleware } from '@/modules/observability/middleware/trace-context.middleware';
import { ObservabilityLogsController } from '@/modules/observability/observability-logs.controller';
import {
  ApplicationLog,
  ApplicationLogSchema,
} from '@/modules/observability/schemas/application-log.schema';
import { ApplicationLogQueryService } from '@/modules/observability/services/application-log-query.service';
import { LogArchiveService } from '@/modules/observability/services/log-archive.service';
import { LogStreamService } from '@/modules/observability/services/log-stream.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      connectionName: 'logs',
      inject: [ConfigService],
      useFactory: (config: ConfigService<IConfig>) => ({
        uri: config.getOrThrow<ObservabilityConfig>('observability')
          .logMongoUri,
        lazyConnection: true,
        serverSelectionTimeoutMS: 5_000,
      }),
    }),
    MongooseModule.forFeatureAsync(
      [
        {
          name: ApplicationLog.name,
          inject: [ConfigService],
          useFactory: (config: ConfigService<IConfig>) => {
            const schema = ApplicationLogSchema.clone();
            const retentionDays =
              config.getOrThrow<ObservabilityConfig>(
                'observability',
              ).retentionDays;
            schema.index(
              { timestamp: 1 },
              { expireAfterSeconds: retentionDays * 24 * 60 * 60 },
            );
            return schema;
          },
        },
      ],
      'logs',
    ),
  ],
  controllers: [AdminLogsController, ObservabilityLogsController],
  providers: [
    TraceContextService,
    TraceContextMiddleware,
    LogStreamService,
    OperationalLoggerService,
    LogArchiveService,
    ApplicationLogQueryService,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
  exports: [
    TraceContextService,
    LogStreamService,
    OperationalLoggerService,
    ApplicationLogQueryService,
  ],
})
export class ObservabilityModule {}
