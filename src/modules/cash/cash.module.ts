import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { CashController } from '@/modules/cash/cash.controller';
import {
  ProcessCashInFreightHandler,
  ProcessCashOutFreightHandler,
} from '@/modules/cash/handlers';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';
import { MasterDataModule } from '@/modules/master-data/master-data.module';

const CommandHandlers = [
  ProcessCashInFreightHandler,
  ProcessCashOutFreightHandler,
];

@Module({
  imports: [
    ExcelModule,
    EntryProcessorsModule,
    DataBatchModule,
    CqrsModule,
    MasterDataModule,
  ],
  controllers: [CashController],
  providers: [...CommandHandlers],
})
export class CashModule {}
