import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { SyncFinancialDimensionsHandler } from '@/modules/master-data/commands/handlers/sync-financial-dimensions.handler';
import { SyncBillingDataHandler } from '@/modules/master-data/commands/handlers/sync-billing-data.handler';
import { MasterDataController } from '@/modules/master-data/master-data.controller';
import { GetFinancialDimensionsHandler } from '@/modules/master-data/queries/handlers/get-financial-dimensions.handler';
import { GetBillingClassificationsHandler } from '@/modules/master-data/queries/handlers/get-billing-classifications.handler';
import { GetBillingCodesHandler } from '@/modules/master-data/queries/handlers/get-billing-codes.handler';
import { MasterDataService } from '@/modules/master-data/master-data.service';

const CommandHandlers = [
  SyncFinancialDimensionsHandler,
  SyncBillingDataHandler,
];

const QueryHandlers = [
  GetFinancialDimensionsHandler,
  GetBillingClassificationsHandler,
  GetBillingCodesHandler,
];

@Module({
  imports: [CqrsModule.forRoot(), D365FOModule],
  controllers: [MasterDataController],
  providers: [MasterDataService, ...CommandHandlers, ...QueryHandlers],
})
export class MasterDataModule {}
