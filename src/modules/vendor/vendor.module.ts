import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';
import { MasterDataModule } from '@/modules/master-data/master-data.module';
import { QueueModule } from '@/modules/queue/queue.module';
import { PostVendorBatchToDFOHandler } from '@/modules/vendor/commands/handlers/post-vendor-batch-to-dfo.handler';
import { ProcessVendorFreightAdjustmentHandler } from '@/modules/vendor/commands/handlers/process-vendor-freight-adjustment.handler';
import { ProcessVendorFreightHandler } from '@/modules/vendor/commands/handlers/process-vendor-freight.handler';
import { ProcessVendorTruckingAdjustmentHandler } from '@/modules/vendor/commands/handlers/process-vendor-trucking-adjustment.handler';
import { ProcessVendorTruckingHandler } from '@/modules/vendor/commands/handlers/process-vendor-trucking.handler';
import { VendorController } from '@/modules/vendor/vendor.controller';

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
  providers: [
    ProcessVendorFreightHandler,
    ProcessVendorFreightAdjustmentHandler,
    ProcessVendorTruckingHandler,
    ProcessVendorTruckingAdjustmentHandler,
    PostVendorBatchToDFOHandler,
  ],
})
export class VendorModule {}
