import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { DeleteBatchCommand } from '../delete-batch.command';
import { DataBatchService } from '../../services/data-batch.service';

@CommandHandler(DeleteBatchCommand)
export class DeleteBatchHandler implements ICommandHandler<DeleteBatchCommand> {
  constructor(private readonly batchService: DataBatchService) {}

  async execute(command: DeleteBatchCommand): Promise<void> {
    await this.batchService.deleteAsync(command.batchId);
  }
}

