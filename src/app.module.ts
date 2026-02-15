import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import {
  appConfig,
  authConfig,
  d365foConfig,
  dbConfig,
  redisConfig,
  ConfigSchema,
  resilienceConfig,
  schedulerConfig,
} from '@/config';
import { AccountsReceivableModule } from '@/modules/accounts-receivable/accounts-receivable.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { CashModule } from '@/modules/cash/cash.module';
import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { DBModule } from '@/modules/db/db.module';
import { LedgerModule } from '@/modules/ledger/ledger.module';
import { MasterDataModule } from '@/modules/master-data/master-data.module';
import { QueueModule } from '@/modules/queue/queue.module';
import { ResilienceModule } from '@/modules/resilience/resilience.module';
import { SchedulerModule } from '@/modules/scheduler/scheduler.module';
import { SettingsModule } from '@/modules/settings/settings.module';
import { UserModule } from '@/modules/user/user.module';
import { VendorModule } from '@/modules/vendor/vendor.module';

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

    AuthModule,
    VendorModule,
    CashModule,
    LedgerModule,
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
  ],
})
export class AppModule {}
