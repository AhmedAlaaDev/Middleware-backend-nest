import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { CashOutController } from '@/modules/cash-out/cash-out.controller';
import { ProcessCashOutFreightHandler } from '@/modules/cash-out/commands/handlers/process-cash-out-freight.handler';
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
  controllers: [CashOutController],
  providers: [ProcessCashOutFreightHandler],
})
export class CashOutModule {}
