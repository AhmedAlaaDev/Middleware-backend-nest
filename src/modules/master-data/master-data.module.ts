import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';

import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import {
  CreateSyncBillingDataJobHandler,
  CreateSyncCustomersJobHandler,
  CreateSyncExchangeRatesJobHandler,
  CreateSyncFinancialDimensionsJobHandler,
  CreateSyncMainAccountsJobHandler,
  CreateSyncVendorsJobHandler,
  SaveAccountMappingsHandler,
  SyncBillingDataHandler,
  SyncCustomersHandler,
  SyncExchangeRatesHandler,
  SyncFinancialDimensionsHandler,
  SyncMainAccountsHandler,
  SyncVendorsHandler,
} from '@/modules/master-data/commands/handlers';
import { MasterDataController } from '@/modules/master-data/master-data.controller';
import {
  GetAccountMappingsHandler,
  GetBillingClassificationsHandler,
  GetBillingCodesHandler,
  GetCustomersHandler,
  GetExchangeRatesHandler,
  GetFinancialDimensionsHandler,
  GetFinancialDimensionWithValueHandler,
  GetMainAccountsHandler,
  GetSyncJobsHandler,
  GetSyncStatusHandler,
  GetVendorsHandler,
} from '@/modules/master-data/queries/handlers';
import {
  AccountCustomerInvoiceMappingMongoRepository,
  BillingClassificationMongoRepository,
  BillingCodeMongoRepository,
  CustomerMongoRepository,
  ExchangeRateMongoRepository,
  FinancialDimensionMongoRepository,
  FinancialDimensionValueMongoRepository,
  MainAccountMongoRepository,
  SyncJobMongoRepository,
  VendorMongoRepository,
} from '@/modules/master-data/repositories';
import {
  AccountCustomerInvoiceMappingRepository,
  BillingClassificationRepository,
  BillingCodeRepository,
  CustomerRepository,
  ExchangeRateRepository,
  FinancialDimensionRepository,
  FinancialDimensionValueRepository,
  MainAccountRepository,
  SyncJobRepository,
  VendorRepository,
} from '@/modules/master-data/repositories/interfaces';
import {
  AccountCustomerInvoiceMapping,
  AccountCustomerInvoiceMappingSchema,
  BillingClassification,
  BillingClassificationSchema,
  BillingCode,
  BillingCodeSchema,
  Customer,
  CustomerSchema,
  ExchangeRate,
  ExchangeRateSchema,
  FinancialDimension,
  FinancialDimensionSchema,
  FinancialDimensionValue,
  FinancialDimensionValueSchema,
  MainAccount,
  MainAccountSchema,
  SyncJob,
  SyncJobSchema,
  Vendor,
  VendorSchema,
} from '@/modules/master-data/schemas';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

const CommandHandlers = [
  CreateSyncCustomersJobHandler,
  CreateSyncFinancialDimensionsJobHandler,
  CreateSyncBillingDataJobHandler,
  CreateSyncMainAccountsJobHandler,
  CreateSyncVendorsJobHandler,
  CreateSyncExchangeRatesJobHandler,
  SyncFinancialDimensionsHandler,
  SyncBillingDataHandler,
  SyncMainAccountsHandler,
  SaveAccountMappingsHandler,
  SyncCustomersHandler,
  SyncVendorsHandler,
  SyncExchangeRatesHandler,
];

const QueryHandlers = [
  GetFinancialDimensionsHandler,
  GetFinancialDimensionWithValueHandler,
  GetBillingClassificationsHandler,
  GetBillingCodesHandler,
  GetMainAccountsHandler,
  GetAccountMappingsHandler,
  GetCustomersHandler,
  GetVendorsHandler,
  GetExchangeRatesHandler,
  GetSyncJobsHandler,
  GetSyncStatusHandler,
];

@Module({
  imports: [
    CqrsModule.forRoot(),
    D365FOModule,
    MongooseModule.forFeature([
      { name: Vendor.name, schema: VendorSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: MainAccount.name, schema: MainAccountSchema },
      { name: BillingCode.name, schema: BillingCodeSchema },
      {
        name: BillingClassification.name,
        schema: BillingClassificationSchema,
      },
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
      { name: FinancialDimension.name, schema: FinancialDimensionSchema },
      {
        name: FinancialDimensionValue.name,
        schema: FinancialDimensionValueSchema,
      },
      {
        name: AccountCustomerInvoiceMapping.name,
        schema: AccountCustomerInvoiceMappingSchema,
      },
      { name: SyncJob.name, schema: SyncJobSchema },
    ]),
  ],
  controllers: [MasterDataController],
  providers: [
    MasterDataService,
    { provide: VendorRepository, useClass: VendorMongoRepository },
    { provide: CustomerRepository, useClass: CustomerMongoRepository },
    { provide: MainAccountRepository, useClass: MainAccountMongoRepository },
    { provide: BillingCodeRepository, useClass: BillingCodeMongoRepository },
    {
      provide: BillingClassificationRepository,
      useClass: BillingClassificationMongoRepository,
    },
    { provide: ExchangeRateRepository, useClass: ExchangeRateMongoRepository },
    {
      provide: FinancialDimensionRepository,
      useClass: FinancialDimensionMongoRepository,
    },
    {
      provide: FinancialDimensionValueRepository,
      useClass: FinancialDimensionValueMongoRepository,
    },
    {
      provide: AccountCustomerInvoiceMappingRepository,
      useClass: AccountCustomerInvoiceMappingMongoRepository,
    },
    {
      provide: SyncJobRepository,
      useClass: SyncJobMongoRepository,
    },
    ...CommandHandlers,
    ...QueryHandlers,
  ],
  exports: [MasterDataService, SyncJobRepository],
})
export class MasterDataModule {}
