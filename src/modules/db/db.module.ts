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
  BillingClassification,
  BillingClassificationSchema,
} from '@/modules/db/schemas/billing-classification.schema';
import {
  BillingCode,
  BillingCodeSchema,
} from '@/modules/db/schemas/billing-code.schema';
import {
  CacheEntry,
  CacheEntrySchema,
} from '@/modules/db/schemas/cache-entry.schema';
import { Customer, CustomerSchema } from '@/modules/db/schemas/customer.schema';
import {
  ExchangeRate,
  ExchangeRateSchema,
} from '@/modules/db/schemas/exchange-rate.schema';
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
import { Vendor, VendorSchema } from '@/modules/db/schemas/vendor.schema';

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
      {
        name: Customer.name,
        schema: CustomerSchema,
      },
    ]),
  ],
  providers: [DBService],
  exports: [DBService],
})
export class DBModule {}
