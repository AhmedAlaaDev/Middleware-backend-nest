import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { SyncFinancialDimensionsHandler } from '@/modules/master-data/commands/handlers/sync-financial-dimensions.handler';
import { UpdateFinancialDimensionsHandler } from '@/modules/master-data/commands/handlers/update-financial-dimensions.handler';
import { MasterDataController } from '@/modules/master-data/master-data.controller';
import { GetFinancialDimensionsHandler } from '@/modules/master-data/queries/handlers/get-financial-dimensions.handler';
import { MasterDataService } from '@/modules/master-data/master-data.service';

const CommandHandlers = [
  SyncFinancialDimensionsHandler,
  UpdateFinancialDimensionsHandler,
];

const QueryHandlers = [GetFinancialDimensionsHandler];

@Module({
  imports: [CqrsModule.forRoot(), D365FOModule],
  controllers: [MasterDataController],
  providers: [MasterDataService, ...CommandHandlers, ...QueryHandlers],
})
export class MasterDataModule {}
