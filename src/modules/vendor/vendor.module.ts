import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';
import { MasterDataModule } from '@/modules/master-data/master-data.module';
import { QueueModule } from '@/modules/queue/queue.module';
import {
  PostVendorBatchToDFOHandler,
  ProcessVendorFreightAdjustmentHandler,
  ProcessVendorFreightHandler,
  ProcessVendorTruckingAdjustmentHandler,
  ProcessVendorTruckingHandler,
} from '@/modules/vendor/handlers';
import { VendorController } from '@/modules/vendor/vendor.controller';

const CommandHandlers = [
  PostVendorBatchToDFOHandler,
  ProcessVendorFreightAdjustmentHandler,
  ProcessVendorFreightHandler,
  ProcessVendorTruckingAdjustmentHandler,
  ProcessVendorTruckingHandler,
];

@Module({
  imports: [
    ExcelModule,
    EntryProcessorsModule,
    DataBatchModule,
    CqrsModule,
    MasterDataModule,
    QueueModule,
  ],
  controllers: [VendorController],
  providers: [...CommandHandlers],
})
export class VendorModule {}
