import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from '@/app.controller';
import {
  appConfig,
  authConfig,
  d365foConfig,
  dbConfig,
  ConfigSchema,
  resilienceConfig,
} from '@/config';
import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { DBModule } from '@/modules/db/db.module';
import { MasterDataModule } from '@/modules/master-data/master-data.module';
import { ResilienceModule } from '@/modules/resilience/resilience.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [appConfig, authConfig, d365foConfig, dbConfig, resilienceConfig],
      isGlobal: true,
      validationSchema: ConfigSchema,
      validationOptions: {
        abortEarly: true,
      },
      // envFilePath: `.env.development`,
    }),

    ResilienceModule,
    DBModule,
    D365FOModule,
    MasterDataModule,
    DataBatchModule,
  ],

  controllers: [AppController],
})
export class AppModule {}
