import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';

import {
  CreateDataBatchHandler,
  DeleteBatchHandler,
  DownloadBatchEnhancedRecordHandler,
  DownloadBatchErrorHandler,
  PostBatchInDFOHandler,
} from '@/modules/data-batch/commands/handlers';
import { DataBatchController } from '@/modules/data-batch/data-batch.controller';
import {
  GetBatchErrorListHandler,
  GetDataBatchByIdHandler,
  GetDataBatchListHandler,
} from '@/modules/data-batch/queries/handlers';
import {
  DataBatchErrorMongoRepository,
  DataBatchMongoRepository,
  DataEnhancedRecordMongoRepository,
  DataSourceRecordMongoRepository,
} from '@/modules/data-batch/repositories';
import {
  DataBatchErrorRepository,
  DataBatchRepository,
  DataEnhancedRecordRepository,
  DataSourceRecordRepository,
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
} from '@/modules/data-batch/schemas';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ExcelModule } from '@/modules/excel/excel.module';

const CommandHandlers = [
  CreateDataBatchHandler,
  PostBatchInDFOHandler,
  DeleteBatchHandler,
  DownloadBatchEnhancedRecordHandler,
  DownloadBatchErrorHandler,
];

const QueryHandlers = [
  GetDataBatchListHandler,
  GetDataBatchByIdHandler,
  GetBatchErrorListHandler,
];

@Module({
  imports: [
    CqrsModule.forRoot(),
    ExcelModule,
    MongooseModule.forFeature([
      { name: DataBatch.name, schema: DataBatchSchema },
      { name: DataBatchError.name, schema: DataBatchErrorSchema },
      { name: DataSourceRecord.name, schema: DataSourceRecordSchema },
      { name: DataEnhancedRecord.name, schema: DataEnhancedRecordSchema },
    ]),
  ],
  providers: [
    DataBatchService,
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

    ...CommandHandlers,
    ...QueryHandlers,
  ],
  controllers: [DataBatchController],
  exports: [DataBatchService],
})
export class DataBatchModule {}
