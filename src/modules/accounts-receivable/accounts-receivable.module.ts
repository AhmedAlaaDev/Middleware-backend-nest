import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AccountsReceivableController } from '@/modules/accounts-receivable/accounts-receivable.controller';
import {
  PostARBatchToDFOHandler,
  ProcessARFreightCreditNoteHandler,
  ProcessARFreightHandler,
  ProcessARTruckingCreditNoteHandler,
  ProcessARTruckingHandler,
  ProcessARYardHandler,
} from '@/modules/accounts-receivable/handlers';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';
import { QueueModule } from '@/modules/queue/queue.module';

const CommandHandlers = [
  PostARBatchToDFOHandler,
  ProcessARFreightHandler,
  ProcessARFreightCreditNoteHandler,
  ProcessARTruckingHandler,
  ProcessARTruckingCreditNoteHandler,
  ProcessARYardHandler,
];

@Module({
  imports: [
    ExcelModule,
    EntryProcessorsModule,
    DataBatchModule,
    QueueModule,
    CqrsModule,
  ],
  controllers: [AccountsReceivableController],
  providers: [...CommandHandlers],
})
export class AccountsReceivableModule {}
