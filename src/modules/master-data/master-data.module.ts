import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import {
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
  GetVendorsHandler,
} from '@/modules/master-data/queries/handlers';

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
  GetFinancialDimensionWithValueHandler,
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
