import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { SaveAccountMappingsHandler } from '@/modules/master-data/commands/handlers/save-account-mappings.handler';
import { SyncBillingDataHandler } from '@/modules/master-data/commands/handlers/sync-billing-data.handler';
import { SyncCustomersHandler } from '@/modules/master-data/commands/handlers/sync-customers.handler';
import { SyncExchangeRatesHandler } from '@/modules/master-data/commands/handlers/sync-exchange-rates.handler';
import { SyncFinancialDimensionsHandler } from '@/modules/master-data/commands/handlers/sync-financial-dimensions.handler';
import { SyncMainAccountsHandler } from '@/modules/master-data/commands/handlers/sync-main-accounts.handler';
import { SyncVendorsHandler } from '@/modules/master-data/commands/handlers/sync-vendors.handler';
import { MasterDataController } from '@/modules/master-data/master-data.controller';
import { GetAccountMappingsHandler } from '@/modules/master-data/queries/handlers/get-account-mappings.handler';
import { GetBillingClassificationsHandler } from '@/modules/master-data/queries/handlers/get-billing-classifications.handler';
import { GetBillingCodesHandler } from '@/modules/master-data/queries/handlers/get-billing-codes.handler';
import { GetCustomersHandler } from '@/modules/master-data/queries/handlers/get-customers.handler';
import { GetExchangeRatesHandler } from '@/modules/master-data/queries/handlers/get-exchange-rates.handler';
import { GetFinancialDimensionsHandler } from '@/modules/master-data/queries/handlers/get-financial-dimensions.handler';
import { GetMainAccountsHandler } from '@/modules/master-data/queries/handlers/get-main-accounts.handler';
import { GetVendorsHandler } from '@/modules/master-data/queries/handlers/get-vendors.handler';

const CommandHandlers = [
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
  GetBillingClassificationsHandler,
  GetBillingCodesHandler,
  GetMainAccountsHandler,
  GetAccountMappingsHandler,
  GetCustomersHandler,
  GetVendorsHandler,
  GetExchangeRatesHandler,
];

@Module({
  imports: [CqrsModule.forRoot(), D365FOModule],
  controllers: [MasterDataController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class MasterDataModule {}
