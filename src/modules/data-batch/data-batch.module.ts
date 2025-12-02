import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { DataBatchController } from '@/modules/data-batch/data-batch.controller';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';

@Module({
  imports: [CqrsModule.forRoot()],
  providers: [DataBatchService],
  controllers: [DataBatchController],
})
export class DataBatchModule {}
