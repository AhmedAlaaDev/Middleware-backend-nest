import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';
import { ProcessFreightClosingEntryHandler } from '@/modules/ledger/commands/handlers/process-freight-closing-entry.handler';
import { ProcessTruckingClosingEntryHandler } from '@/modules/ledger/commands/handlers/process-trucking-closing-entry.handler';
import { LedgerController } from '@/modules/ledger/ledger.controller';

@Module({
  imports: [ExcelModule, EntryProcessorsModule, DataBatchModule, CqrsModule],
  controllers: [LedgerController],
  providers: [
    ProcessFreightClosingEntryHandler,
    ProcessTruckingClosingEntryHandler,
  ],
})
export class LedgerModule {}
