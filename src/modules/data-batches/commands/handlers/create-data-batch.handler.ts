import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { CreateDataBatchCommand } from '../create-data-batch.command';
import { DataBatchService } from '../../services/data-batch.service';
import { OperationResultDto } from '../../../../common/dto/operation-result.dto';

@CommandHandler(CreateDataBatchCommand)
export class CreateDataBatchHandler
  implements ICommandHandler<CreateDataBatchCommand>
{
  constructor(private readonly batchService: DataBatchService) {}

  async execute(
    command: CreateDataBatchCommand,
  ): Promise<OperationResultDto<any>> {
    const batch = await this.batchService.createAsync(
      command.entryProcessorType,
      command.entryProcessorName,
      command.companyId,
      command.description,
      command.rawData,
      command.dynData,
      command.billingClassification,
    );

    return OperationResultDto.success(batch);
  }
}

