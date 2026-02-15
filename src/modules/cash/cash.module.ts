import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { CashInController } from '@/modules/cash/cash-in/cash-in.controller';
import { ProcessCashInFreightHandler } from '@/modules/cash/cash-in/commands/handlers/process-cash-in-freight.handler';
import { CashOutController } from '@/modules/cash/cash-out/cash-out.controller';
import { ProcessCashOutFreightHandler } from '@/modules/cash/cash-out/commands/handlers/process-cash-out-freight.handler';
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
  controllers: [CashInController, CashOutController],
  providers: [ProcessCashInFreightHandler, ProcessCashOutFreightHandler],
})
export class CashModule {}
