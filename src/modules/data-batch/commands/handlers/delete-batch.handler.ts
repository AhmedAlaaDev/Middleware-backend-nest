import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { DeleteBatchCommand } from '@/modules/data-batch/commands/delete-batch.command';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { QueueService } from '@/modules/queue/services/queue.service';

@CommandHandler(DeleteBatchCommand)
export class DeleteBatchHandler implements ICommandHandler<DeleteBatchCommand> {
  private readonly logger = new Logger(DeleteBatchHandler.name);

  constructor(
    private readonly dataBatchService: DataBatchService,
    private readonly queues: QueueService,
    private readonly logs: OperationalLoggerService,
  ) {}

  async execute(command: DeleteBatchCommand): Promise<void> {
    const { batchId, actor } = command;

    const batch = await this.dataBatchService.getByIdAsync(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${batchId} not found`);
    }

    if (batch.status === DataBatchStatus.Posted) {
      throw new ConflictException(
        'This batch has already been posted to DFO and cannot be deleted.',
      );
    }

    const activeJobIds = await this.queues.findActiveJobsForBatch(batchId);
    if (activeJobIds.length) {
      throw new ConflictException(
        'This batch cannot be deleted while a related job is queued or running.',
      );
    }

    await this.dataBatchService.deleteAsync(batchId);

    this.logger.log(`Deleted batch ${batchId} and all related records`);
    await this.logs.emit({
      level: 'info',
      message: `Batch ${batchId} hard-deleted`,
      context: DeleteBatchHandler.name,
      eventType: 'batch.deleted',
      status: 'completed',
      batchId,
      userId: actor.id,
      metadata: {
        actorName: actor.name,
        actorEmail: actor.email,
        deletionMode: 'hard-delete',
      },
    });
  }
}
