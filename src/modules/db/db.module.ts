import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { DBConfig, IConfig } from '@/config';
import { DBService } from '@/modules/db/db.service';
import {
  AppSetting,
  AppSettingSchema,
} from '@/modules/db/schemas/app-setting.schema';
import {
  CacheEntry,
  CacheEntrySchema,
} from '@/modules/db/schemas/cache-entry.schema';
import {
  LedgerEntryBatchCounter,
  LedgerEntryBatchCounterSchema,
} from '@/modules/db/schemas/ledger-entry-batch-counter.schema';
import {
  LedgerVoucherCounter,
  LedgerVoucherCounterSchema,
} from '@/modules/db/schemas/ledger-voucher-counter.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<IConfig>) => {
        const dbConfig = cfg.get<DBConfig>('db');
        if (!dbConfig) throw new Error('DB config not found');
        return {
          uri: dbConfig.mongodbUri,
          maxPoolSize: dbConfig.mongodbMaxPoolSize,
        };
      },
    }),

    MongooseModule.forFeature([
      { name: LedgerVoucherCounter.name, schema: LedgerVoucherCounterSchema },
      {
        name: LedgerEntryBatchCounter.name,
        schema: LedgerEntryBatchCounterSchema,
      },
      {
        name: CacheEntry.name,
        schema: CacheEntrySchema,
      },
      {
        name: AppSetting.name,
        schema: AppSettingSchema,
      },
    ]),
  ],
  providers: [DBService],
  exports: [DBService],
})
export class DBModule {}
