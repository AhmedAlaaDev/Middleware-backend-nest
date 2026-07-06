import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import {
  appConfig,
  authConfig,
  d365foConfig,
  dbConfig,
  redisConfig,
  ConfigSchema,
  resilienceConfig,
  schedulerConfig,
  observabilityConfig,
  entraConfig,
} from '@/config';
import { AccountsReceivableModule } from '@/modules/accounts-receivable/accounts-receivable.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { CashModule } from '@/modules/cash/cash.module';
import { ClosingModule } from '@/modules/closing/closing.module';
import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { DBModule } from '@/modules/db/db.module';
import { HealthModule } from '@/modules/health/health.module';
import { MasterDataModule } from '@/modules/master-data/master-data.module';
import { ObservabilityModule } from '@/modules/observability/observability.module';
import { QueueModule } from '@/modules/queue/queue.module';
import { ResilienceModule } from '@/modules/resilience/resilience.module';
import { SchedulerModule } from '@/modules/scheduler/scheduler.module';
import { SettingsModule } from '@/modules/settings/settings.module';
import { UserModule } from '@/modules/user/user.module';
import { VendorModule } from '@/modules/vendor/vendor.module';
import { ReconciliationModule } from '@/modules/reconciliation/reconciliation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [
        appConfig,
        authConfig,
        d365foConfig,
        dbConfig,
        redisConfig,
        resilienceConfig,
        schedulerConfig,
        observabilityConfig,
        entraConfig,
      ],
      isGlobal: true,
      validationSchema: ConfigSchema,
      validationOptions: {
        abortEarly: true,
      },
      envFilePath: [
        `.env.${process.env.NODE_ENV || 'local'}`,
        '.env.local',
        '.env',
      ],
    }),
    LoggerModule.forRoot({
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        autoLogging: false,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers.x-refresh-token',
            'password',
            'passwordHash',
            'clientSecret',
            'accessToken',
            'refreshToken',
          ],
          censor: '[REDACTED]',
        },
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, colorize: true },
              },
      },
    }),

    AuthModule,
    VendorModule,
    CashModule,
    ClosingModule,
    AccountsReceivableModule,
    DataBatchModule,
    MasterDataModule,
    SettingsModule,
    ResilienceModule,
    DBModule,
    QueueModule,
    D365FOModule,
    UserModule,
    SchedulerModule,
    ObservabilityModule,
    HealthModule,
    ReconciliationModule,
  ],
})
export class AppModule {}
