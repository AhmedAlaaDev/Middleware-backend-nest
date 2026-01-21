import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AccountsReceivableController } from '@/modules/accounts-receivable/accounts-receivable.controller';
import { PostARBatchToDFOHandler } from '@/modules/accounts-receivable/commands/handlers/post-ar-batch-to-dfo.handler';
import { ProcessARFreightCreditNoteHandler } from '@/modules/accounts-receivable/commands/handlers/process-ar-freight-credit-note.handler';
import { ProcessARFreightHandler } from '@/modules/accounts-receivable/commands/handlers/process-ar-freight.handler';
import { ProcessARTruckingCreditNoteHandler } from '@/modules/accounts-receivable/commands/handlers/process-ar-trucking-credit-note.handler';
import { ProcessARTruckingHandler } from '@/modules/accounts-receivable/commands/handlers/process-ar-trucking.handler';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';
import { QueueModule } from '@/modules/queue/queue.module';

@Module({
  imports: [
    ExcelModule,
    EntryProcessorsModule,
    DataBatchModule,
    QueueModule,
    CqrsModule,
  ],
  controllers: [AccountsReceivableController],
  providers: [
    ProcessARFreightHandler,
    ProcessARFreightCreditNoteHandler,
    ProcessARTruckingHandler,
    ProcessARTruckingCreditNoteHandler,
    PostARBatchToDFOHandler,
  ],
})
export class AccountsReceivableModule {}
