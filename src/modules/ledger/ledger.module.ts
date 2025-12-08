import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { LedgerController } from '@/modules/ledger/ledger.controller';
import { ProcessTruckingClosingEntryHandler } from '@/modules/ledger/commands/handlers/process-trucking-closing-entry.handler';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';

@Module({
  imports: [ExcelModule, EntryProcessorsModule, DataBatchModule, CqrsModule],
  controllers: [LedgerController],
  providers: [ProcessTruckingClosingEntryHandler],
})
export class LedgerModule {}

