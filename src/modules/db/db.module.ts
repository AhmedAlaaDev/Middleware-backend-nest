import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { DBConfig, IConfig } from '@/config';
import { DBService } from '@/modules/db/db.service';
import {
  AccountCustomerInvoiceMapping,
  AccountCustomerInvoiceMappingSchema,
} from '@/modules/db/schemas/account-customer-invoice-mapping.schema';
import {
  AppSetting,
  AppSettingSchema,
} from '@/modules/db/schemas/app-setting.schema';
import {
  CacheEntry,
  CacheEntrySchema,
} from '@/modules/db/schemas/cache-entry.schema';
import {
  DataBatchError,
  DataBatchErrorSchema,
} from '@/modules/db/schemas/data-batch-error.schema';
import {
  DataBatch,
  DataBatchSchema,
} from '@/modules/db/schemas/data-batch.schema';
import {
  DataEnhancedRecord,
  DataEnhancedRecordSchema,
} from '@/modules/db/schemas/data-enhanced-record.schema';
import {
  DataSourceRecord,
  DataSourceRecordSchema,
} from '@/modules/db/schemas/data-source-record.schema';
import {
  FinancialDimensionValue,
  FinancialDimensionValueSchema,
} from '@/modules/db/schemas/financial-dimension-value.schema';
import {
  FinancialDimension,
  FinancialDimensionSchema,
} from '@/modules/db/schemas/financial-dimension.schema';
import {
  LedgerEntryBatchCounter,
  LedgerEntryBatchCounterSchema,
} from '@/modules/db/schemas/ledger-entry-batch-counter.schema';
import {
  LedgerVoucherCounter,
  LedgerVoucherCounterSchema,
} from '@/modules/db/schemas/ledger-voucher-counter.schema';
import {
  MainAccount,
  MainAccountSchema,
} from '@/modules/db/schemas/main-account.schema';
import {
  BillingClassification,
  BillingClassificationSchema,
} from '@/modules/db/schemas/billing-classification.schema';
import {
  BillingCode,
  BillingCodeSchema,
} from '@/modules/db/schemas/billing-code.schema';
import {
  Vendor,
  VendorSchema,
} from '@/modules/db/schemas/vendor.schema';
import {
  ExchangeRate,
  ExchangeRateSchema,
} from '@/modules/db/schemas/exchange-rate.schema';

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
      { name: DataBatch.name, schema: DataBatchSchema },
      { name: DataEnhancedRecord.name, schema: DataEnhancedRecordSchema },
      { name: DataSourceRecord.name, schema: DataSourceRecordSchema },
      { name: DataBatchError.name, schema: DataBatchErrorSchema },
      { name: LedgerVoucherCounter.name, schema: LedgerVoucherCounterSchema },
      {
        name: LedgerEntryBatchCounter.name,
        schema: LedgerEntryBatchCounterSchema,
      },
      {
        name: AccountCustomerInvoiceMapping.name,
        schema: AccountCustomerInvoiceMappingSchema,
      },
      {
        name: FinancialDimensionValue.name,
        schema: FinancialDimensionValueSchema,
      },
      {
        name: CacheEntry.name,
        schema: CacheEntrySchema,
      },
      {
        name: AppSetting.name,
        schema: AppSettingSchema,
      },
      {
        name: FinancialDimension.name,
        schema: FinancialDimensionSchema,
      },
      {
        name: MainAccount.name,
        schema: MainAccountSchema,
      },
      {
        name: BillingClassification.name,
        schema: BillingClassificationSchema,
      },
      {
        name: BillingCode.name,
        schema: BillingCodeSchema,
      },
      {
        name: Vendor.name,
        schema: VendorSchema,
      },
      {
        name: ExchangeRate.name,
        schema: ExchangeRateSchema,
      },
    ]),
  ],
  providers: [DBService],
  exports: [DBService],
})
export class DBModule {}
