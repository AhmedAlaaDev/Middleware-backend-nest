import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { dfoErrorMessage } from '@/modules/d365fo/errors/dfo-api.error';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import {
  PostVendorJournalDFOJobPayload,
  VendorJournalPostingGroup,
} from '@/modules/queue/contracts/post-vendor-journal-dfo-job.contract';
import { QueueJobGroupStatus } from '@/modules/queue/schemas/queue-job-group.schema';
import { BatchPostingControlService } from '@/modules/queue/services/batch-posting-control.service';
import { CreatedHeader } from '@/modules/queue/services/dfo-rollback.service';
import { PostingErrorCollector } from '@/modules/queue/services/posting-error-collector.service';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';
import { IDfoPostingStrategy } from '@/modules/queue/strategies/dfo-posting-strategy.interface';
import { VendorJournalPostingStrategy } from '@/modules/queue/strategies/vendor-journal-posting.strategy';
import { VendorPaymentJournalPostingStrategy } from '@/modules/queue/strategies/vendor-payment-journal-posting.strategy';

const LINE_CHUNK_SIZE = 20;

/** Why the worker stopped walking the journals of a batch. */
type PostGroupsOutcome = 'completed' | 'paused';

@Processor(QUEUES.DFO_VENDOR_JOURNAL, { concurrency: 1 })
export class PostVendorJournalDFOProcessor extends WorkerHost {
  constructor(
    private readonly invoiceStrategy: VendorJournalPostingStrategy,
    private readonly paymentStrategy: VendorPaymentJournalPostingStrategy,
    private readonly batches: DataBatchService,
    private readonly jobs: QueueJobStoreService,
    private readonly logs: OperationalLoggerService,
    private readonly trace: TraceContextService,
    private readonly pauseControl: BatchPostingControlService,
  ) {
    super();
  }

  process(job: Job<PostVendorJournalDFOJobPayload>): Promise<void> {
    return this.trace.run(
      {
        correlationId: job.data.correlationId,
        batchId: job.data.batchId,
        jobId: String(job.id),
        queueName: QUEUES.DFO_VENDOR_JOURNAL,
      },
      () => this.processJob(job),
    );
  }

  private async processJob(
    job: Job<PostVendorJournalDFOJobPayload>,
  ): Promise<void> {
    const jobId = String(job.id);
    const collector = new PostingErrorCollector();
    const strategy =
      job.data.journalKind === 'payment'
        ? this.paymentStrategy
        : this.invoiceStrategy;
    const legacyPayload = job.data as PostVendorJournalDFOJobPayload & {
      groupedJournals?: VendorJournalPostingGroup[];
      paymentGroupedJournals?: VendorJournalPostingGroup[];
    };
    const legacyGroups =
      legacyPayload.journalKind === 'payment'
        ? legacyPayload.paymentGroupedJournals
        : legacyPayload.groupedJournals;
    if (legacyGroups?.length) {
      await this.jobs.prepare({
        ...job.data,
        correlationId: job.data.correlationId ?? job.data.batchId,
        payloadVersion: 1,
        jobId,
        queueName: QUEUES.DFO_VENDOR_JOURNAL,
        jobName: job.name,
        groups: legacyGroups,
      });
    }
    await this.jobs.markActive(jobId, job.attemptsMade);
    await this.emit('queue.job.active', 'active');

    try {
      if ((await this.postGroups(job, strategy)) === 'paused') {
        return;
      }
      await this.jobs.markCompleted(jobId);
      await this.emit('queue.job.completed', 'completed');
    } catch (error) {
      const message = dfoErrorMessage(error);
      collector.addHeaderError(message, 'Job processing');
      const finalAttempt = this.isFinalAttempt(job);
      if (finalAttempt) {
        await this.jobs.markFailed(jobId, message);
        await this.failBatch(job.data.batchId, collector);
      } else {
        await this.jobs.markRetrying(jobId, message);
      }
      await this.emit(
        finalAttempt ? 'queue.job.failed' : 'queue.job.retrying',
        finalAttempt ? 'failed' : 'retrying',
        error,
      );
      throw error;
    }
  }

  private async postGroups(
    job: Job<PostVendorJournalDFOJobPayload>,
    strategy: IDfoPostingStrategy,
  ): Promise<PostGroupsOutcome> {
    const jobId = String(job.id);
    const groups = await this.jobs.listGroups<VendorJournalPostingGroup>(jobId);
    if (!groups.length) throw new Error('No durable vendor groups found');
    // Headers created in this attempt (or reused from a prior attempt). Finance
    // owns FO cleanup on failure; the IDs are kept so a retry can resume from
    // the failed journal instead of re-posting the whole batch from the start.
    const created: CreatedHeader[] = [];
    let completedGroups = groups.filter(
      (record) => record.status === QueueJobGroupStatus.COMPLETED,
    ).length;

    for (const record of groups) {
      if (record.status === QueueJobGroupStatus.COMPLETED) continue;
      // Checked between journals, never inside one: a half-written journal
      // cannot be left behind, and stopping here needs no rollback.
      if (await this.pauseControl.isPaused(job.data.batchId)) {
        await this.pauseControl.recordWorkerStopped({
          batchId: job.data.batchId,
          jobId,
          queueName: QUEUES.DFO_VENDOR_JOURNAL,
          completedGroups,
          totalGroups: groups.length,
        });
        return 'paused';
      }
      await this.jobs.markGroupActive(jobId, record.index);
      try {
        let headerId = record.createdHeaderId;
        // The journal may have been deleted (or its number reused) by Finance
        // since the last attempt. Reuse the number only when the header still
        // holds our data; otherwise create a fresh header.
        if (headerId && strategy.headerExists) {
          if (!(await strategy.headerExists(headerId, job.data.company))) {
            headerId = undefined;
          }
        }
        if (!headerId) {
          const result = await strategy.postHeadersInBatches(
            [record.payload.header],
            1,
          );
          if (result.headerIds.length !== 1) {
            throw new Error('D365FO did not return one vendor header ID');
          }
          headerId = result.headerIds[0];
          await this.jobs.setCreatedHeader(jobId, record.index, headerId);
        }
        created.push({ headerKey: headerId, dataAreaId: job.data.company });
        await strategy.postLinesForHeader(
          headerId,
          record.payload.lines,
          job.data.company,
          LINE_CHUNK_SIZE,
        );
        await this.jobs.completeGroup(jobId, record.index);
        completedGroups += 1;
        await job.updateProgress({
          completedGroups: record.index + 1,
          totalGroups: groups.length,
        });
      } catch (error) {
        // No rollback on failure: the finance backend owns FO cleanup. Keep
        // completed groups and persisted header IDs so the next attempt resumes
        // from this journal and skips lines that already posted.
        if (created.length) {
          await this.storeHeaderIds(
            job.data.batchId,
            created.map((header) => header.headerKey),
          );
        }
        throw error;
      }
    }

    await this.completeBatch(job.data.batchId, [
      ...groups
        .map((group) => group.createdHeaderId)
        .filter((id): id is string => Boolean(id)),
      ...created.map((header) => header.headerKey),
    ]);
    return 'completed';
  }

  private async completeBatch(
    batchId: string,
    headerIds: string[],
  ): Promise<void> {
    await this.storeHeaderIds(batchId, headerIds);
    await this.batches.clearDfoPostingErrorsAsync(batchId);
    await this.batches.updateStatusAsync(batchId, DataBatchStatus.Posted);
  }

  private async failBatch(
    batchId: string,
    collector: PostingErrorCollector,
  ): Promise<void> {
    await this.batches.updateDfoPostingErrorsAsync(
      batchId,
      collector.getFormattedErrorMessages(),
    );
    await this.batches.updateStatusAsync(batchId, DataBatchStatus.Canceled);
  }

  private async storeHeaderIds(
    batchId: string,
    headerIds: string[],
  ): Promise<void> {
    if (!headerIds.length) return;
    const batch = await this.batches.getByIdAsync(batchId);
    await this.batches.updateDfoIdsAsync(batchId, [
      ...new Set([...(batch?.dfoIds ?? []), ...headerIds]),
    ]);
  }

  private isFinalAttempt(job: Job): boolean {
    return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  }

  private emit(
    eventType: string,
    status: string,
    error?: unknown,
  ): Promise<void> {
    return this.logs.emit({
      level: error ? 'error' : 'info',
      message: `Vendor posting job ${status}`,
      context: PostVendorJournalDFOProcessor.name,
      eventType,
      status,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : undefined,
    });
  }
}
