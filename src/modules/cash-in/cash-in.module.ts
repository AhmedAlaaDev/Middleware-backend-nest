import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { CashInController } from '@/modules/cash-in/cash-in.controller';
import { ProcessCashInFreightHandler } from '@/modules/cash-in/commands/handlers/process-cash-in-freight.handler';
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
  controllers: [CashInController],
  providers: [ProcessCashInFreightHandler],
})
export class CashInModule {}
