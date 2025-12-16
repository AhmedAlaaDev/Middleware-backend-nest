import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AccountsReceivableController } from '@/modules/accounts-receivable/accounts-receivable.controller';
import { ProcessARFreightCreditNoteHandler } from '@/modules/accounts-receivable/commands/handlers/process-ar-freight-credit-note.handler';
import { ProcessARFreightHandler } from '@/modules/accounts-receivable/commands/handlers/process-ar-freight.handler';
import { ProcessARTruckingCreditNoteHandler } from '@/modules/accounts-receivable/commands/handlers/process-ar-trucking-credit-note.handler';
import { ProcessARTruckingHandler } from '@/modules/accounts-receivable/commands/handlers/process-ar-trucking.handler';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';

@Module({
  imports: [ExcelModule, EntryProcessorsModule, DataBatchModule, CqrsModule],
  controllers: [AccountsReceivableController],
  providers: [
    ProcessARFreightHandler,
    ProcessARFreightCreditNoteHandler,
    ProcessARTruckingHandler,
    ProcessARTruckingCreditNoteHandler,
  ],
})
export class AccountsReceivableModule {}
