import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AccountsReceivableController } from '@/modules/accounts-receivable/accounts-receivable.controller';
import { ProcessARFreightHandler } from '@/modules/accounts-receivable/commands/handlers/process-ar-freight.handler';
import { ProcessARTruckingHandler } from '@/modules/accounts-receivable/commands/handlers/process-ar-trucking.handler';

@Module({
  imports: [ExcelModule, EntryProcessorsModule, DataBatchModule, CqrsModule],
  controllers: [AccountsReceivableController],
  providers: [ProcessARFreightHandler, ProcessARTruckingHandler],
})
export class AccountsReceivableModule {}
