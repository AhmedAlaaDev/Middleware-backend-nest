import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { AddDfoIdsCommand } from '@/modules/data-batch/commands/add-dfo-ids.command';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';

@CommandHandler(AddDfoIdsCommand)
export class AddDfoIdsHandler implements ICommandHandler<AddDfoIdsCommand> {
  private readonly logger = new Logger(AddDfoIdsHandler.name);

  constructor(private readonly dataBatchService: DataBatchService) {}

  public async execute(command: AddDfoIdsCommand): Promise<void> {
    const { batchId, dfoIds } = command;

    this.logger.log(`Updating batch ${batchId} with ${dfoIds.length} DFO IDs`);

    await this.dataBatchService.updateDfoIdsAsync(batchId, dfoIds);
  }
}
