import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { CashController } from '@/modules/cash/cash.controller';
import {
  ProcessCashInFreightHandler,
  ProcessCashInTruckingHandler,
  ProcessCashOutFreightHandler,
  ProcessCashOutTruckingHandler,
  PostCashBatchToDFOHandler,
} from '@/modules/cash/handlers';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';
import { MasterDataModule } from '@/modules/master-data/master-data.module';

const CommandHandlers = [
  ProcessCashInFreightHandler,
  ProcessCashOutFreightHandler,
  ProcessCashInTruckingHandler,
  ProcessCashOutTruckingHandler,
  PostCashBatchToDFOHandler,
];

@Module({
  imports: [
    ExcelModule,
    EntryProcessorsModule,
    DataBatchModule,
    CqrsModule,
    MasterDataModule,
  ],
  controllers: [CashController],
  providers: [CashJournalRoutingService, ...CommandHandlers],
})
export class CashModule {}
