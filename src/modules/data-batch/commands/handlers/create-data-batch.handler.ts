import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { CreateDataBatchCommand } from '@/modules/data-batch/commands/create-data-batch.command';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';

@CommandHandler(CreateDataBatchCommand)
export class CreateDataBatchHandler implements ICommandHandler<CreateDataBatchCommand> {
  private readonly logger = new Logger(CreateDataBatchHandler.name);

  constructor(private readonly dataBatchService: DataBatchService) {}

  public async execute(command: CreateDataBatchCommand): Promise<IDataBatch> {
    const dataBatch = await this.dataBatchService.createAsync(
      command.entryProcessorType,
      command.entryProcessorName,
      command.companyId,
      command.description,
      command.rawData,
      command.dynData,
      command.billingClassification,
    );

    this.logger.log(
      `Created batch ${dataBatch.id} with ${command.rawData.length} source records and ${command.dynData.length} enhanced records`,
    );

    return dataBatch;
  }
}
