import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';

import {
  AddDfoIdsHandler,
  CreateDataBatchHandler,
  DeleteBatchHandler,
  DownloadBatchEnhancedRecordHandler,
  DownloadBatchErrorHandler,
  DownloadBatchSourceRecordHandler,
  ReprocessBatchHandler,
  SetBatchPostingPauseHandler,
} from '@/modules/data-batch/commands/handlers';
import { DataBatchController } from '@/modules/data-batch/data-batch.controller';
import { BatchOwnerOrAdminGuard } from '@/modules/data-batch/guards/batch-owner-or-admin.guard';
import {
  GetBatchErrorListHandler,
  GetDataBatchByIdHandler,
  GetDataBatchListHandler,
  GetMissingMasterDataHandler,
  GetRemediationSummaryHandler,
} from '@/modules/data-batch/queries/handlers';
import {
  DataBatchErrorMongoRepository,
  DataBatchMongoRepository,
  DataEnhancedRecordMongoRepository,
  DataSourceRecordMongoRepository,
  DataBatchMissingMasterDataMongoRepository,
} from '@/modules/data-batch/repositories';
import {
  DataBatchErrorRepository,
  DataBatchRepository,
  DataEnhancedRecordRepository,
  DataSourceRecordRepository,
  DataBatchMissingMasterDataRepository,
} from '@/modules/data-batch/repositories/interfaces';
import {
  DataBatch,
  DataBatchError,
  DataBatchErrorSchema,
  DataBatchSchema,
  DataEnhancedRecord,
  DataEnhancedRecordSchema,
  DataSourceRecord,
  DataSourceRecordSchema,
  DataBatchMissingMasterData,
  DataBatchMissingMasterDataSchema,
} from '@/modules/data-batch/schemas';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';

const CommandHandlers = [
  AddDfoIdsHandler,
  CreateDataBatchHandler,
  DeleteBatchHandler,
  DownloadBatchEnhancedRecordHandler,
  DownloadBatchErrorHandler,
  DownloadBatchSourceRecordHandler,
  ReprocessBatchHandler,
  SetBatchPostingPauseHandler,
];

const QueryHandlers = [
  GetDataBatchListHandler,
  GetDataBatchByIdHandler,
  GetBatchErrorListHandler,
  GetMissingMasterDataHandler,
  GetRemediationSummaryHandler,
];

@Module({
  imports: [
    CqrsModule.forRoot(),
    ExcelModule,
    EntryProcessorsModule,
    MongooseModule.forFeature([
      { name: DataBatch.name, schema: DataBatchSchema },
      { name: DataBatchError.name, schema: DataBatchErrorSchema },
      { name: DataSourceRecord.name, schema: DataSourceRecordSchema },
      { name: DataEnhancedRecord.name, schema: DataEnhancedRecordSchema },
      {
        name: DataBatchMissingMasterData.name,
        schema: DataBatchMissingMasterDataSchema,
      },
    ]),
  ],
  providers: [
    DataBatchService,
    BatchOwnerOrAdminGuard,
    { provide: DataBatchRepository, useClass: DataBatchMongoRepository },
    {
      provide: DataBatchErrorRepository,
      useClass: DataBatchErrorMongoRepository,
    },
    {
      provide: DataSourceRecordRepository,
      useClass: DataSourceRecordMongoRepository,
    },
    {
      provide: DataEnhancedRecordRepository,
      useClass: DataEnhancedRecordMongoRepository,
    },
    {
      provide: DataBatchMissingMasterDataRepository,
      useClass: DataBatchMissingMasterDataMongoRepository,
    },

    ...CommandHandlers,
    ...QueryHandlers,
  ],
  controllers: [DataBatchController],
  exports: [DataBatchService, DataBatchMissingMasterDataRepository],
})
export class DataBatchModule {}
