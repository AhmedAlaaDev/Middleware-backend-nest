import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { ReprocessBatchCommand } from '@/modules/data-batch/commands/reprocess-batch.command';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';

@CommandHandler(ReprocessBatchCommand)
export class ReprocessBatchHandler implements ICommandHandler<ReprocessBatchCommand> {
  private readonly logger = new Logger(ReprocessBatchHandler.name);

  constructor(private readonly dataBatchService: DataBatchService) {}

  async execute(command: ReprocessBatchCommand): Promise<void> {
    const { batchId, missingDataId } = command;
    await this.dataBatchService.reprocessBatchAsync(batchId, missingDataId);
    this.logger.log(`Reprocessed batch ${batchId}`);
  }
}
