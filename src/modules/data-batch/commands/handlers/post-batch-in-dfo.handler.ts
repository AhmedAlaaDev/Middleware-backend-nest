import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { PostBatchInDFOCommand } from '@/modules/data-batch/commands/post-batch-in-dfo.command';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { QueueService } from '@/modules/queue/services/queue.service';

@CommandHandler(PostBatchInDFOCommand)
export class PostBatchInDFOHandler implements ICommandHandler<PostBatchInDFOCommand> {
  constructor(
    private readonly batchService: DataBatchService,
    private readonly queueService: QueueService,
  ) {}

  public async execute(command: PostBatchInDFOCommand): Promise<void> {
    const batch = await this.batchService.getByIdAsync(command.batchId);

    if (!batch) {
      throw new Error(`Batch with ID ${command.batchId} not found`);
    }

    // Update status to Processing
    await this.batchService.updateStatusAsync(
      command.batchId,
      DataBatchStatus.Processing,
    );

    // Enqueue background job
    await this.queueService.addJob('dfo-queue', 'post-batch', {
      batchId: command.batchId,
      company: batch.company,
      entryProcessorName: batch.entryProcessorName,
    });
  }
}
