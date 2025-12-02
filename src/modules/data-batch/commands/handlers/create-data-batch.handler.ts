import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { CreateDataBatchCommand } from '@/modules/data-batch/commands/create-data-batch.command';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { DataBatch } from '@/modules/db/schemas/data-batch.schema';

@CommandHandler(CreateDataBatchCommand)
export class CreateDataBatchHandler implements ICommandHandler<CreateDataBatchCommand> {
  constructor(private readonly dataBatchService: DataBatchService) {}

  public async execute(command: CreateDataBatchCommand): Promise<DataBatch> {
    return this.dataBatchService.createAsync(
      command.entryProcessorType,
      command.entryProcessorName,
      command.companyId,
      command.description,
      command.rawData,
      command.dynData,
      command.billingClassification,
    );
  }
}
