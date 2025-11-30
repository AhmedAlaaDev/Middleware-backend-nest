import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import { DataBatchService } from './services/data-batch.service';
import { DataBatchController } from './controllers/data-batch.controller';
import {
  DataBatch,
  DataBatchSchema,
} from './schemas/data-batch.schema';
import {
  DataSourceRecord,
  DataSourceRecordSchema,
} from './schemas/data-source-record.schema';
import {
  DataEnhancedRecord,
  DataEnhancedRecordSchema,
} from './schemas/data-enhanced-record.schema';
import {
  DataBatchError,
  DataBatchErrorSchema,
} from './schemas/data-batch-error.schema';
import { CreateDataBatchHandler } from './commands/handlers/create-data-batch.handler';
import { GetDataBatchListHandler } from './queries/handlers/get-data-batch-list.handler';
import { GetBatchErrorListHandler } from './queries/handlers/get-batch-error-list.handler';
import { PostBatchInDFOHandler } from './commands/handlers/post-batch-indfo.handler';
import { DeleteBatchHandler } from './commands/handlers/delete-batch.handler';
import { DownloadBatchEnhancedRecordHandler } from './commands/handlers/download-batch-enhanced-record.handler';
import { DownloadBatchErrorHandler } from './commands/handlers/download-batch-error.handler';
import { EntryProcessorsModule } from '../entry-processors/entry-processors.module';

const CommandHandlers = [
  CreateDataBatchHandler,
  PostBatchInDFOHandler,
  DeleteBatchHandler,
  DownloadBatchEnhancedRecordHandler,
  DownloadBatchErrorHandler,
];

const QueryHandlers = [
  GetDataBatchListHandler,
  GetBatchErrorListHandler,
];

@Module({
  imports: [
    CqrsModule,
    MongooseModule.forFeature([
      { name: DataBatch.name, schema: DataBatchSchema },
      { name: DataSourceRecord.name, schema: DataSourceRecordSchema },
      { name: DataEnhancedRecord.name, schema: DataEnhancedRecordSchema },
      { name: DataBatchError.name, schema: DataBatchErrorSchema },
    ]),
    EntryProcessorsModule,
  ],
  controllers: [DataBatchController],
  providers: [DataBatchService, ...CommandHandlers, ...QueryHandlers],
  exports: [DataBatchService],
})
export class DataBatchesModule {}

