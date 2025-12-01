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
import { MasterDataModule } from '@/modules/master-data/master-data.module';
import { PrismaModule } from '@/modules/prisma/prisma.module';
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
    PrismaModule,
    D365FOModule,
    MasterDataModule,
  ],

  controllers: [AppController],
})
export class AppModule {}
