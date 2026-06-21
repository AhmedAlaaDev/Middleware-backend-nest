import { Module, forwardRef } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';

import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import {
  CreateSyncBillingDataJobHandler,
  CreateSyncCustomersJobHandler,
  CreateSyncExchangeRatesJobHandler,
  CreateSyncFinancialDimensionsJobHandler,
  CreateSyncLedgersJobHandler,
  CreateSyncMainAccountsJobHandler,
  CreateSyncPaymentTermsJobHandler,
  CreateSyncTaxItemGroupHeadingsJobHandler,
  CreateSyncVendorsJobHandler,
  SaveAccountMappingsHandler,
  SyncBillingDataHandler,
  SyncCustomersHandler,
  SyncExchangeRatesHandler,
  SyncFinancialDimensionsHandler,
  SyncLedgersHandler,
  SyncMainAccountsHandler,
  SyncPaymentTermsHandler,
  SyncTaxItemGroupHeadingsHandler,
  SyncVendorsHandler,
  CreateCustomerFromMissingDataHandler,
} from '@/modules/master-data/commands/handlers';
import { MasterDataController } from '@/modules/master-data/master-data.controller';
import {
  GetAccountMappingsHandler,
  GetBillingClassificationsHandler,
  GetBillingCodeVersionsHandler,
  GetBillingCodesHandler,
  GetCustomersHandler,
  GetExchangeRatesHandler,
  GetFinancialDimensionsHandler,
  GetFinancialDimensionValueHandler,
  GetLedgersHandler,
  GetMainAccountsHandler,
  GetPaymentTermsHandler,
  GetTaxItemGroupHeadingsHandler,
  GetSyncJobsHandler,
  GetSyncStatusHandler,
  GetVendorsHandler,
} from '@/modules/master-data/queries/handlers';
import {
  AccountCustomerInvoiceMappingMongoRepository,
  BillingClassificationMongoRepository,
  BillingCodeMongoRepository,
  BillingCodeVersionMongoRepository,
  CustomerMongoRepository,
  ExchangeRateMongoRepository,
  FinancialDimensionMongoRepository,
  FinancialDimensionValueMongoRepository,
  LedgerMongoRepository,
  MainAccountMongoRepository,
  PaymentTermMongoRepository,
  TaxItemGroupHeadingMongoRepository,
  SyncJobMongoRepository,
  VendorMongoRepository,
} from '@/modules/master-data/repositories';
import {
  AccountCustomerInvoiceMappingRepository,
  BillingClassificationRepository,
  BillingCodeRepository,
  BillingCodeVersionRepository,
  CustomerRepository,
  ExchangeRateRepository,
  FinancialDimensionRepository,
  FinancialDimensionValueRepository,
  LedgerRepository,
  MainAccountRepository,
  PaymentTermRepository,
  TaxItemGroupHeadingRepository,
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
  BillingCodeVersion,
  BillingCodeVersionSchema,
  Customer,
  CustomerSchema,
  ExchangeRate,
  ExchangeRateSchema,
  FinancialDimension,
  FinancialDimensionSchema,
  FinancialDimensionValue,
  FinancialDimensionValueSchema,
  Ledger,
  LedgerSchema,
  MainAccount,
  MainAccountSchema,
  PaymentTerm,
  PaymentTermSchema,
  TaxItemGroupHeading,
  TaxItemGroupHeadingSchema,
  SyncJob,
  SyncJobSchema,
  Vendor,
  VendorSchema,
} from '@/modules/master-data/schemas';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';
import { ExchangeRateService } from '@/modules/master-data/services/exchange-rate.service';
import { InlineCustomerCreationService } from '@/modules/master-data/services/inline-customer-creation.service';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';
import { TaxGroupService } from '@/modules/master-data/services/tax-group.service';

const CommandHandlers = [
  CreateSyncCustomersJobHandler,
  CreateSyncFinancialDimensionsJobHandler,
  CreateSyncBillingDataJobHandler,
  CreateSyncMainAccountsJobHandler,
  CreateSyncVendorsJobHandler,
  CreateSyncExchangeRatesJobHandler,
  CreateSyncPaymentTermsJobHandler,
  CreateSyncTaxItemGroupHeadingsJobHandler,
  CreateSyncLedgersJobHandler,
  SyncFinancialDimensionsHandler,
  SyncBillingDataHandler,
  SyncMainAccountsHandler,
  SaveAccountMappingsHandler,
  SyncCustomersHandler,
  SyncVendorsHandler,
  SyncExchangeRatesHandler,
  SyncPaymentTermsHandler,
  SyncTaxItemGroupHeadingsHandler,
  SyncLedgersHandler,
  CreateCustomerFromMissingDataHandler,
];

const QueryHandlers = [
  GetFinancialDimensionsHandler,
  GetFinancialDimensionValueHandler,
  GetBillingClassificationsHandler,
  GetBillingCodesHandler,
  GetBillingCodeVersionsHandler,
  GetMainAccountsHandler,
  GetAccountMappingsHandler,
  GetCustomersHandler,
  GetVendorsHandler,
  GetExchangeRatesHandler,
  GetPaymentTermsHandler,
  GetTaxItemGroupHeadingsHandler,
  GetSyncJobsHandler,
  GetSyncStatusHandler,
  GetLedgersHandler,
];

@Module({
  imports: [
    CqrsModule.forRoot(),
    D365FOModule,
    forwardRef(() => DataBatchModule),
    MongooseModule.forFeature([
      { name: Vendor.name, schema: VendorSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: MainAccount.name, schema: MainAccountSchema },
      { name: BillingCode.name, schema: BillingCodeSchema },
      { name: BillingCodeVersion.name, schema: BillingCodeVersionSchema },
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
      { name: PaymentTerm.name, schema: PaymentTermSchema },
      {
        name: TaxItemGroupHeading.name,
        schema: TaxItemGroupHeadingSchema,
      },
      { name: Ledger.name, schema: LedgerSchema },
      { name: SyncJob.name, schema: SyncJobSchema },
    ]),
  ],
  controllers: [MasterDataController],
  providers: [
    DimensionValidationService,
    ExchangeRateService,
    TaxGroupService,
    MasterDataService,
    InlineCustomerCreationService,
    { provide: VendorRepository, useClass: VendorMongoRepository },
    { provide: CustomerRepository, useClass: CustomerMongoRepository },
    { provide: MainAccountRepository, useClass: MainAccountMongoRepository },
    { provide: BillingCodeRepository, useClass: BillingCodeMongoRepository },
    {
      provide: BillingCodeVersionRepository,
      useClass: BillingCodeVersionMongoRepository,
    },
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
      provide: PaymentTermRepository,
      useClass: PaymentTermMongoRepository,
    },
    {
      provide: TaxItemGroupHeadingRepository,
      useClass: TaxItemGroupHeadingMongoRepository,
    },
    {
      provide: LedgerRepository,
      useClass: LedgerMongoRepository,
    },
    {
      provide: SyncJobRepository,
      useClass: SyncJobMongoRepository,
    },
    ...CommandHandlers,
    ...QueryHandlers,
  ],
  exports: [
    DimensionValidationService,
    MasterDataService,
    ExchangeRateService,
    TaxGroupService,
    SyncJobRepository,
  ],
})
export class MasterDataModule {}
