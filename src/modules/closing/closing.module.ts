import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { ClosingController } from '@/modules/closing/closing.controller';
import {
  ProcessFreightClosingEntryHandler,
  PostClosingBatchToDFOHandler,
  ProcessClosingFreightDifferenceHandler,
  ProcessCustodySettlementEntryHandler,
  ProcessTruckingClosingEntryHandler,
} from '@/modules/closing/handlers';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';

@Module({
  imports: [ExcelModule, EntryProcessorsModule, DataBatchModule, CqrsModule],
  controllers: [ClosingController],
  providers: [
    ProcessFreightClosingEntryHandler,
    ProcessClosingFreightDifferenceHandler,
    ProcessCustodySettlementEntryHandler,
    ProcessTruckingClosingEntryHandler,
    PostClosingBatchToDFOHandler,
  ],
})
export class ClosingModule {}
