import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { CreateDataBatchHandler } from '@/modules/data-batch/commands/handlers/create-data-batch.handler';
import { DeleteBatchHandler } from '@/modules/data-batch/commands/handlers/delete-batch.handler';
import { DownloadBatchEnhancedRecordHandler } from '@/modules/data-batch/commands/handlers/download-batch-enhanced-record.handler';
import { DownloadBatchErrorHandler } from '@/modules/data-batch/commands/handlers/download-batch-error.handler';
import { PostBatchInDFOHandler } from '@/modules/data-batch/commands/handlers/post-batch-in-dfo.handler';
import { DataBatchController } from '@/modules/data-batch/data-batch.controller';
import { GetBatchErrorListHandler } from '@/modules/data-batch/queries/handlers/get-batch-error-list.handler';
import { GetDataBatchListHandler } from '@/modules/data-batch/queries/handlers/get-data-batch-list.handler';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';

const CommandHandlers = [
  CreateDataBatchHandler,
  PostBatchInDFOHandler,
  DeleteBatchHandler,
  DownloadBatchEnhancedRecordHandler,
  DownloadBatchErrorHandler,
];

const QueryHandlers = [GetDataBatchListHandler, GetBatchErrorListHandler];

@Module({
  imports: [CqrsModule.forRoot()],
  providers: [DataBatchService, ...CommandHandlers, ...QueryHandlers],
  controllers: [DataBatchController],
})
export class DataBatchModule {}
