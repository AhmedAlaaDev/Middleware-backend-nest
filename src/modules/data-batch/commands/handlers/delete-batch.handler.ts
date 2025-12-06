import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { DeleteBatchCommand } from '@/modules/data-batch/commands/delete-batch.command';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';

@CommandHandler(DeleteBatchCommand)
export class DeleteBatchHandler implements ICommandHandler<DeleteBatchCommand> {
  private readonly logger = new Logger(DeleteBatchHandler.name);

  constructor(private readonly dataBatchService: DataBatchService) {}

  async execute(command: DeleteBatchCommand): Promise<void> {
    const { batchId } = command;

    await this.dataBatchService.deleteAsync(batchId);

    this.logger.log(`Deleted batch ${batchId} and all related records`);
  }
}
