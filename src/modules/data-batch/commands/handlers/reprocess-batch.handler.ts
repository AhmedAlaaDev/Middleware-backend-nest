import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { ReprocessBatchCommand } from '@/modules/data-batch/commands/reprocess-batch.command';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { DataBatchReprocessSubmission } from '@/modules/queue/contracts/data-batch-reprocess-job.contract';
import { QueueService } from '@/modules/queue/services/queue.service';

@CommandHandler(ReprocessBatchCommand)
export class ReprocessBatchHandler implements ICommandHandler<ReprocessBatchCommand> {
  private readonly logger = new Logger(ReprocessBatchHandler.name);

  constructor(
    private readonly dataBatchService: DataBatchService,
    private readonly queueService: QueueService,
  ) {}

  async execute(
    command: ReprocessBatchCommand,
  ): Promise<DataBatchReprocessSubmission> {
    const submission = await this.queueService.enqueueBatchReprocess({
      batchId: command.batchId,
      userId: command.actor.id,
      userName: command.actor.name,
      userEmail: command.actor.email,
    });
    if (submission.status === 'queued') {
      await this.dataBatchService.recordReprocessQueued(command.batchId, {
        at: new Date(),
        userId: command.actor.id,
        userName: command.actor.name,
        userEmail: command.actor.email,
        jobId: submission.jobId,
      });
    }
    this.logger.log(
      `Batch ${command.batchId} reprocess submission: ${submission.status}`,
    );
    return submission;
  }
}
