import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';
import { MasterDataModule } from '@/modules/master-data/master-data.module';
import { ProcessVendorFreightHandler } from '@/modules/vendor/commands/handlers/process-vendor-freight.handler';
import { ProcessVendorTruckingHandler } from '@/modules/vendor/commands/handlers/process-vendor-trucking.handler';
import { VendorController } from '@/modules/vendor/vendor.controller';

@Module({
  imports: [
    ExcelModule,
    EntryProcessorsModule,
    DataBatchModule,
    CqrsModule,
    MasterDataModule,
  ],
  controllers: [VendorController],
  providers: [ProcessVendorFreightHandler, ProcessVendorTruckingHandler],
})
export class VendorModule {}
