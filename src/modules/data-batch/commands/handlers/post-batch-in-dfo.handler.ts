import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { PostBatchInDFOCommand } from '@/modules/data-batch/commands/post-batch-in-dfo.command';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { DataBatchStatus } from '@/modules/db/schemas/data-batch.schema';

@CommandHandler(PostBatchInDFOCommand)
export class PostBatchInDFOHandler implements ICommandHandler<PostBatchInDFOCommand> {
  constructor(private readonly batchService: DataBatchService) {}

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

    // TODO: Implement Queue logic @nestjs/bullmq bullmq
    // // Enqueue background job
    // await this.postingQueue.add('post-batch-to-d365fo', {
    //   batchId: command.batchId,
    //   company: batch.company,
    //   entryProcessorName: batch.entryProcessorName,
    // });
  }
}
