import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { DurableQueueJobStatus } from '@/modules/queue/schemas/queue-job.schema';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';
import { QueueService } from '@/modules/queue/services/queue.service';

export interface BatchPostingActor {
  id: string;
  name: string;
  email: string;
}

export interface BatchPostingPauseState {
  batchId: string;
  paused: boolean;
  status: DataBatchStatus;
  /** True while a worker is still finishing the journal it had started. */
  stopping: boolean;
  pausedAt: Date | null;
  pausedByName: string | null;
  jobId?: string;
  jobStatus?: DurableQueueJobStatus;
  completedGroups?: number;
  totalGroups?: number;
  message: string;
}

/** One posting that has not finished yet, as shown in Observability. */
export interface InFlightPosting {
  batchId: string;
  jobId: string;
  queueName: string;
  jobStatus: DurableQueueJobStatus;
  sourceModule: string;
  company: string;
  completedGroups: number;
  totalGroups: number;
  paused: boolean;
  /** Paused, but the worker is still finishing the journal it started. */
  stopping: boolean;
  updatedAt?: Date;
}

/**
 * Pause and resume the posting of one batch to D365FO.
 *
 * Pausing is cooperative: BullMQ cannot interrupt a job that is already
 * running, so the flag is stored on the batch and the posting workers read it
 * between journals. A worker that finds it set stops after the journal it has
 * finished, leaving the completed journals completed and the durable job in the
 * `paused` state. Resuming puts the same durable job back on its queue, which
 * continues with the journals that are still pending.
 */
@Injectable()
export class BatchPostingControlService {
  private readonly logger = new Logger(BatchPostingControlService.name);

  constructor(
    private readonly batches: DataBatchService,
    private readonly jobs: QueueJobStoreService,
    private readonly queues: QueueService,
    private readonly logs: OperationalLoggerService,
  ) {}

  /**
   * Read by the posting workers before each journal. A missing batch means it
   * was force-deleted while posting: stop between journals and exit cleanly.
   */
  public async isPaused(batchId: string): Promise<boolean> {
    const batch = await this.batches.getByIdAsync(batchId);
    if (!batch) return true;
    return Boolean(batch.postingPaused);
  }

  /**
   * Postings that have not finished: queued, running, retrying, or stopped on a
   * paused batch. Used by the Observability controls.
   */
  public async listInFlight(limit = 50): Promise<InFlightPosting[]> {
    const jobs = await this.jobs.listByStatuses(
      [
        DurableQueueJobStatus.QUEUED,
        DurableQueueJobStatus.ACTIVE,
        DurableQueueJobStatus.RETRYING,
        DurableQueueJobStatus.PAUSED,
      ],
      limit,
    );
    const pausedBatchIds = new Set(
      await this.batches.listPostingPausedIdsAsync(
        jobs.map((job) => job.batchId),
      ),
    );

    return jobs.map((job) => {
      const paused = pausedBatchIds.has(job.batchId);
      return {
        batchId: job.batchId,
        jobId: job.jobId,
        queueName: job.queueName,
        jobStatus: job.status,
        sourceModule: job.sourceModule,
        company: job.company,
        completedGroups: job.completedGroups ?? 0,
        totalGroups: job.totalGroups ?? 0,
        paused,
        stopping: paused && job.status !== DurableQueueJobStatus.PAUSED,
        updatedAt: (job as { updatedAt?: Date }).updatedAt,
      };
    });
  }

  public async getState(batchId: string): Promise<BatchPostingPauseState> {
    const batch = await this.requireBatch(batchId);
    return this.describe(batch, await this.findJob(batchId));
  }

  public async pause(
    batchId: string,
    actor: BatchPostingActor,
  ): Promise<BatchPostingPauseState> {
    const batch = await this.requireBatch(batchId);

    if (batch.status === DataBatchStatus.Posted) {
      throw new BatchPostingControlError(
        `Batch ${batchId} is already posted to D365FO and cannot be paused.`,
      );
    }
    if (batch.postingPaused) {
      return this.describe(batch, await this.findJob(batchId));
    }

    const updated = await this.batches.setPostingPauseAsync(batchId, true, {
      at: new Date(),
      userId: actor.id,
      userName: actor.name,
      userEmail: actor.email,
    });
    const paused = updated ?? batch;
    const job = await this.findJob(batchId);

    this.logger.log(
      `Posting paused for batch ${batchId} by ${actor.email} (status ${paused.status})`,
    );
    await this.logs.emit({
      level: 'warn',
      message: `Posting paused for batch ${batchId}`,
      context: BatchPostingControlService.name,
      eventType: 'batch.posting.paused',
      batchId,
      jobId: job?.jobId,
      queueName: job?.queueName,
      status: 'paused',
      metadata: {
        batchStatus: paused.status,
        pausedBy: actor.email,
        completedGroups: job?.completedGroups,
        totalGroups: job?.totalGroups,
      },
    });

    return this.describe(paused, job);
  }

  public async resume(
    batchId: string,
    actor: BatchPostingActor,
  ): Promise<BatchPostingPauseState> {
    const batch = await this.requireBatch(batchId);

    if (!batch.postingPaused) {
      return this.describe(batch, await this.findJob(batchId));
    }

    const updated = await this.batches.setPostingPauseAsync(batchId, false, {
      at: new Date(),
      userId: actor.id,
      userName: actor.name,
      userEmail: actor.email,
    });
    const resumed = updated ?? batch;
    const job = await this.findJob(batchId);
    let requeued = false;

    // A job left in `paused` still holds the pending journals, so it is put
    // back on its queue. Any other state means there is nothing to continue:
    // the batch simply becomes postable again.
    if (job && job.status === DurableQueueJobStatus.PAUSED) {
      const outcome = await this.queues.requeueDurableJob({
        jobId: job.jobId,
        queueName: job.queueName,
        jobName: job.jobName,
        batchId: job.batchId,
        company: job.company,
        correlationId: job.correlationId,
        sourceModule: job.sourceModule,
        payloadVersion: job.payloadVersion,
        journalKind: job.journalKind,
        cashDirection: job.cashDirection,
      });
      if (outcome === 'requeued') {
        await this.jobs.markQueued(job.jobId);
        requeued = true;
      }
    }

    this.logger.log(
      `Posting resumed for batch ${batchId} by ${actor.email}${
        requeued ? ` (job ${job?.jobId} requeued)` : ''
      }`,
    );
    await this.logs.emit({
      level: 'info',
      message: `Posting resumed for batch ${batchId}`,
      context: BatchPostingControlService.name,
      eventType: 'batch.posting.resumed',
      batchId,
      jobId: job?.jobId,
      queueName: job?.queueName,
      status: 'resumed',
      metadata: {
        batchStatus: resumed.status,
        resumedBy: actor.email,
        requeued,
        completedGroups: job?.completedGroups,
        totalGroups: job?.totalGroups,
      },
    });

    return {
      ...this.describe(resumed, job),
      jobStatus: requeued ? DurableQueueJobStatus.QUEUED : job?.status,
      message: requeued
        ? `Posting resumed for batch ${batchId}. The remaining journals are queued again.`
        : `Posting resumed for batch ${batchId}.`,
    };
  }

  /**
   * Drop queue work for a batch so it can be hard-deleted, including while a
   * worker is mid-post. The current journal may still finish in D365FO; the
   * worker then sees the batch as paused/missing and stops before the next one.
   */
  public async discardPostingForDelete(
    batchId: string,
    actor: BatchPostingActor,
  ): Promise<{ removedJobIds: string[]; purgedDurableJobIds: string[] }> {
    const openJobs = await this.jobs.listOpenForBatch(batchId);
    const runningRedis = await this.queues.findRunningJobsForBatch(batchId);
    const forcedWhileRunning =
      runningRedis.length > 0 ||
      openJobs.some((job) =>
        [DurableQueueJobStatus.ACTIVE, DurableQueueJobStatus.RETRYING].includes(
          job.status,
        ),
      );

    // Tell any in-flight worker to stop after the journal it is writing.
    const batch = await this.batches.getByIdAsync(batchId);
    if (batch && !batch.postingPaused) {
      await this.batches.setPostingPauseAsync(batchId, true, {
        at: new Date(),
        userId: actor.id,
        userName: actor.name,
        userEmail: actor.email,
      });
    }

    const removedJobIds = await this.queues.removeJobsForBatch(batchId);
    const purgedDurableJobIds: string[] = [];

    for (const job of openJobs) {
      await this.jobs.purgeJob(job.jobId);
      purgedDurableJobIds.push(job.jobId);
    }
    await this.jobs.purgeByBatch(batchId);

    if (
      removedJobIds.length ||
      purgedDurableJobIds.length ||
      forcedWhileRunning
    ) {
      this.logger.warn(
        `Discarded posting work for batch ${batchId} before delete (redis=${removedJobIds.length}, durable=${purgedDurableJobIds.length}, forcedWhileRunning=${forcedWhileRunning}) by ${actor.email}`,
      );
      await this.logs.emit({
        level: 'warn',
        message: `Posting work discarded for batch ${batchId} before delete`,
        context: BatchPostingControlService.name,
        eventType: 'batch.posting.discarded',
        batchId,
        status: 'deleted',
        metadata: {
          removedJobIds,
          purgedDurableJobIds,
          forcedWhileRunning,
          discardedBy: actor.email,
        },
      });
    }

    return { removedJobIds, purgedDurableJobIds };
  }

  /**
   * Called by a posting worker that found the batch paused. The durable job
   * keeps its completed journals so a later resume continues from them.
   */
  public async recordWorkerStopped(args: {
    batchId: string;
    jobId: string;
    queueName: string;
    completedGroups: number;
    totalGroups: number;
  }): Promise<void> {
    // Force-delete may have already purged the durable job; marking paused is
    // then a no-op and the worker still exits cleanly.
    await this.jobs.markPaused(args.jobId);
    this.logger.warn(
      `[QUEUE] Stopped posting batch ${args.batchId} after ${args.completedGroups}/${args.totalGroups} journals: posting is paused or the batch was deleted`,
    );
    await this.logs.emit({
      level: 'warn',
      message: `Posting job ${args.jobId} stopped on a paused or deleted batch`,
      context: BatchPostingControlService.name,
      eventType: 'queue.job.paused',
      batchId: args.batchId,
      jobId: args.jobId,
      queueName: args.queueName,
      status: 'paused',
      metadata: {
        completedGroups: args.completedGroups,
        totalGroups: args.totalGroups,
      },
    });
  }

  private async requireBatch(batchId: string): Promise<IDataBatch> {
    const batch = await this.batches.getByIdAsync(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${batchId} not found`);
    }
    return batch;
  }

  private findJob(batchId: string) {
    return this.jobs.findLatestForBatch(batchId);
  }

  private describe(
    batch: IDataBatch,
    job: Awaited<ReturnType<QueueJobStoreService['findLatestForBatch']>>,
  ): BatchPostingPauseState {
    const stopping = Boolean(
      batch.postingPaused &&
      job &&
      [
        DurableQueueJobStatus.ACTIVE,
        DurableQueueJobStatus.RETRYING,
        DurableQueueJobStatus.QUEUED,
      ].includes(job.status),
    );

    return {
      batchId: batch.id,
      paused: Boolean(batch.postingPaused),
      status: batch.status,
      stopping,
      pausedAt: batch.postingPausedAt ?? null,
      pausedByName: batch.postingPausedByName ?? null,
      jobId: job?.jobId,
      jobStatus: job?.status,
      completedGroups: job?.completedGroups,
      totalGroups: job?.totalGroups,
      message: this.messageFor(batch, stopping),
    };
  }

  private messageFor(batch: IDataBatch, stopping: boolean): string {
    if (!batch.postingPaused) {
      return `Posting is active for batch ${batch.id}.`;
    }
    if (stopping) {
      return 'Posting paused. The worker stops after the journal it is currently writing.';
    }
    return batch.status === DataBatchStatus.Posting
      ? 'Posting paused. The journals that are still pending stay untouched until you resume.'
      : 'Posting paused. The batch cannot be posted to D365FO until you resume.';
  }
}

/** Rejected pause/resume request, mapped to a 400 by the calling controller. */
export class BatchPostingControlError extends Error {}
