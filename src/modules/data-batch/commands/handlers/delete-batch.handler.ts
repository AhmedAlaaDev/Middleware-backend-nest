import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { DeleteBatchCommand } from '@/modules/data-batch/commands/delete-batch.command';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import {
  BatchPostingControlError,
  BatchPostingControlService,
} from '@/modules/queue/services/batch-posting-control.service';

@CommandHandler(DeleteBatchCommand)
export class DeleteBatchHandler implements ICommandHandler<DeleteBatchCommand> {
  private readonly logger = new Logger(DeleteBatchHandler.name);

  constructor(
    private readonly dataBatchService: DataBatchService,
    private readonly postingControl: BatchPostingControlService,
    private readonly logs: OperationalLoggerService,
  ) {}

  async execute(command: DeleteBatchCommand): Promise<void> {
    const { batchId, actor } = command;

    const batch = await this.dataBatchService.getByIdAsync(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${batchId} not found`);
    }

    const hasDfoJournals = (batch.dfoIds ?? []).some((id) =>
      Boolean(id.trim()),
    );

    // Warn when the batch has DFO journals but allow force-deletion
    if (
      batch.status === DataBatchStatus.Posting ||
      batch.status === DataBatchStatus.Posted ||
      hasDfoJournals
    ) {
      this.logger.warn(
        `Force-deleting batch ${batchId} that has DFO state ` +
          `(status=${DataBatchStatus[batch.status]}, dfoIds=${(batch.dfoIds ?? []).join(', ')}). ` +
          `DFO journals will NOT be rolled back automatically.`,
      );
    }

    // Drain queue work first, including an in-flight posting job. The journal
    // the worker is writing may still finish in D365FO; further journals stop.
    let discarded: { removedJobIds: string[]; purgedDurableJobIds: string[] } =
      { removedJobIds: [], purgedDurableJobIds: [] };
    try {
      discarded = await this.postingControl.discardPostingForDelete(
        batchId,
        actor,
      );
    } catch (error) {
      if (error instanceof BatchPostingControlError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    await this.dataBatchService.deleteAsync(batchId);

    this.logger.log(
      `Deleted batch ${batchId} and all related records (discarded ${discarded.purgedDurableJobIds.length} durable job(s))`,
    );
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
        deletionMode: 'force-hard-delete',
        hadDfoJournals: hasDfoJournals,
        dfoIds: batch.dfoIds ?? [],
        previousStatus: DataBatchStatus[batch.status],
        removedJobIds: discarded.removedJobIds,
        purgedDurableJobIds: discarded.purgedDurableJobIds,
      },
    });
  }
}
