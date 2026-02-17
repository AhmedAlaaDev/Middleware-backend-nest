import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { CashController } from '@/modules/cash/cash.controller';
import { ProcessCashInFreightHandler } from '@/modules/cash/commands/handlers/process-cash-in-freight.handler';
import { ProcessCashOutFreightHandler } from '@/modules/cash/commands/handlers/process-cash-out-freight.handler';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';
import { MasterDataModule } from '@/modules/master-data/master-data.module';

@Module({
  imports: [
    ExcelModule,
    EntryProcessorsModule,
    DataBatchModule,
    CqrsModule,
    MasterDataModule,
  ],
  controllers: [CashController],
  providers: [ProcessCashInFreightHandler, ProcessCashOutFreightHandler],
})
export class CashModule {}
