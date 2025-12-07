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
} from '@/config';
import { AccountsReceivableModule } from '@/modules/accounts-receivable/accounts-receivable.module';
import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { DBModule } from '@/modules/db/db.module';
import { MasterDataModule } from '@/modules/master-data/master-data.module';
import { QueueModule } from '@/modules/queue/queue.module';
import { ResilienceModule } from '@/modules/resilience/resilience.module';
import { SettingsModule } from '@/modules/settings/settings.module';

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

    ResilienceModule,
    DBModule,
    QueueModule,
    D365FOModule,
    MasterDataModule,
    DataBatchModule,
    AccountsReceivableModule,
    SettingsModule,
  ],
})
export class AppModule {}
