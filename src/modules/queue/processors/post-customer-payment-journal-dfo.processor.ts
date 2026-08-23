import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { CashJournalRoute } from '@/modules/cash/services/cash-journal-routing.service';
import { dfoErrorMessage } from '@/modules/d365fo/errors/dfo-api.error';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import {
  CashJournalPostingGroup,
  PostCustomerPaymentJournalDFOJobPayload,
  RoutedCashJournalPostingGroup,
} from '@/modules/queue/contracts/post-customer-payment-journal-dfo-job.contract';
import { QueueJobGroupStatus } from '@/modules/queue/schemas/queue-job-group.schema';
import { BatchPostingControlService } from '@/modules/queue/services/batch-posting-control.service';
import {
  CreatedHeader,
  DfoRollbackService,
} from '@/modules/queue/services/dfo-rollback.service';
import { PostingErrorCollector } from '@/modules/queue/services/posting-error-collector.service';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';
import { CashJournalPostingStrategy } from '@/modules/queue/strategies/cash-journal-posting.strategy';
import { CustomerPaymentJournalPostingStrategy } from '@/modules/queue/strategies/customer-payment-journal-posting.strategy';
import { IDfoPostingStrategy } from '@/modules/queue/strategies/dfo-posting-strategy.interface';

const LINE_CHUNK_SIZE = 20;
const ROLLBACK_CHUNK_SIZE = 20;

interface RoutedCreatedHeader extends CreatedHeader {
  route?: CashJournalRoute;
  persisted?: boolean;
}

/** Why the worker stopped walking the journals of a batch. */
type PostGroupsOutcome = 'completed' | 'paused';

@Processor(QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL, { concurrency: 1 })
export class PostCustomerPaymentJournalDFOProcessor extends WorkerHost {
  constructor(
    private readonly strategy: CustomerPaymentJournalPostingStrategy,
    private readonly cashJournalStrategy: CashJournalPostingStrategy,
    private readonly batches: DataBatchService,
    private readonly rollback: DfoRollbackService,
    private readonly jobs: QueueJobStoreService,
    private readonly logs: OperationalLoggerService,
    private readonly trace: TraceContextService,
    private readonly pauseControl: BatchPostingControlService,
  ) {
    super();
  }

  process(job: Job<PostCustomerPaymentJournalDFOJobPayload>): Promise<void> {
    return this.trace.run(
      {
        correlationId: job.data.correlationId,
        batchId: job.data.batchId,
        jobId: String(job.id),
        queueName: QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL,
      },
      () => this.processJob(job),
    );
  }

  private async processJob(
    job: Job<PostCustomerPaymentJournalDFOJobPayload>,
  ): Promise<void> {
    const jobId = String(job.id);
    const collector = new PostingErrorCollector();
    const legacyGroups = (
      job.data as PostCustomerPaymentJournalDFOJobPayload & {
        groupedJournals?: CashJournalPostingGroup[];
      }
    ).groupedJournals;
    if (legacyGroups?.length) {
      await this.jobs.prepare({
        ...job.data,
        correlationId: job.data.correlationId ?? job.data.batchId,
        payloadVersion: job.data.payloadVersion,
        jobId,
        queueName: QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL,
        jobName: job.name,
        groups: legacyGroups,
      });
    }
    await this.jobs.markActive(jobId, job.attemptsMade);
    await this.emit('queue.job.active', 'active');
    try {
      if ((await this.postGroups(job, collector)) === 'paused') return;
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
    job: Job<PostCustomerPaymentJournalDFOJobPayload>,
    collector: PostingErrorCollector,
  ): Promise<PostGroupsOutcome> {
    const jobId = String(job.id);
    const groups = await this.jobs.listGroups<CashJournalPostingGroup>(jobId);
    if (!groups.length) throw new Error('No durable customer payment groups');
    // Include headers completed by an earlier worker attempt so a failure in a
    // later group can still roll the complete middleware batch back atomically.
    const created: RoutedCreatedHeader[] = groups
      .filter(
        (record) =>
          record.status === QueueJobGroupStatus.COMPLETED &&
          Boolean(record.createdHeaderId),
      )
      .map((record) => ({
        headerKey: record.createdHeaderId!,
        dataAreaId: job.data.company,
        route: this.asRoutedGroup(record.payload)?.route,
        persisted: true,
      }));
    let completedGroups = groups.filter(
      (record) => record.status === QueueJobGroupStatus.COMPLETED,
    ).length;

    try {
      for (const record of groups) {
        if (record.status === QueueJobGroupStatus.COMPLETED) continue;
        // Checked between journals, never inside one: a half-written journal
        // cannot be left behind, and stopping here needs no rollback.
        if (await this.pauseControl.isPaused(job.data.batchId)) {
          await this.pauseControl.recordWorkerStopped({
            batchId: job.data.batchId,
            jobId,
            queueName: QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL,
            completedGroups,
            totalGroups: groups.length,
          });
          return 'paused';
        }
        await this.jobs.markGroupActive(jobId, record.index);
        const routedGroup = this.asRoutedGroup(record.payload);
        if (job.data.payloadVersion === 2 && !routedGroup) {
          throw new Error(
            'Cash journal payload version 2 requires route metadata for every group',
          );
        }
        const postingStrategy = this.selectStrategy(
          routedGroup,
          job.data.cashDirection ?? 'in',
        );

        const persistedHeaderId = record.createdHeaderId;
        let headerId = persistedHeaderId;
        if (!headerId) {
          headerId = await this.createAndTrackHeader(
            postingStrategy,
            record.payload.header,
            created,
            jobId,
            record.index,
            job.data.company,
            routedGroup?.route,
          );
        } else {
          created.push({
            headerKey: headerId,
            dataAreaId: job.data.company,
            route: routedGroup?.route,
            persisted: true,
          });
        }
        try {
          await postingStrategy.postLinesForHeader(
            headerId,
            record.payload.lines,
            job.data.company,
            LINE_CHUNK_SIZE,
          );
        } catch (error) {
          if (
            !persistedHeaderId ||
            !this.isMissingPersistedHeaderError(error, persistedHeaderId)
          ) {
            throw error;
          }

          const staleHeaderIndex = created.findIndex(
            (header) => header.headerKey === persistedHeaderId,
          );
          if (staleHeaderIndex >= 0) created.splice(staleHeaderIndex, 1);

          headerId = await this.createAndTrackHeader(
            postingStrategy,
            record.payload.header,
            created,
            jobId,
            record.index,
            job.data.company,
            routedGroup?.route,
          );
          await postingStrategy.postLinesForHeader(
            headerId,
            record.payload.lines,
            job.data.company,
            LINE_CHUNK_SIZE,
          );
        }
        await this.jobs.completeGroup(jobId, record.index);
        completedGroups += 1;
        await job.updateProgress({
          completedGroups: record.index + 1,
          totalGroups: groups.length,
        });
      }
      await this.completeBatch(job.data.batchId, [
        ...groups
          .map((group) => group.createdHeaderId)
          .filter((id): id is string => Boolean(id)),
        ...created.map((header) => header.headerKey),
      ]);
      return 'completed';
    } catch (error) {
      if ((job.data.cashDirection ?? 'in') === 'out') {
        const retainedHeaders = created.filter((header) => header.persisted);
        const orphanHeaders = created.filter((header) => !header.persisted);

        // Cash-out line requests are checkpointed in D365 by LineNumber.
        // Keep every persisted header and its successful lines; the next queue
        // attempt reuses that header and posts only lines not yet present.
        if (retainedHeaders.length) {
          await this.storeHeaderIds(
            job.data.batchId,
            retainedHeaders.map((header) => header.headerKey),
          );
        }

        // A header whose ID could not be persisted cannot be resumed safely;
        // delete only that orphan, never a checkpointed cash-out header.
        if (orphanHeaders.length) {
          const failedToDeleteHeaders = await this.rollbackCreatedHeaders(
            orphanHeaders,
            collector,
            'out',
          );
          if (failedToDeleteHeaders.length) {
            await this.storeHeaderIds(job.data.batchId, failedToDeleteHeaders);
          }
          await this.jobs.resetAfterRollback(
            jobId,
            orphanHeaders.map((header) => header.headerKey),
            failedToDeleteHeaders,
          );
        } else if (!created.length) {
          await this.jobs.resetAfterRollback(jobId, []);
        }
      } else if (created.length) {
        const failedToDeleteHeaders = await this.rollbackCreatedHeaders(
          created,
          collector,
          job.data.cashDirection ?? 'in',
        );
        if (failedToDeleteHeaders.length) {
          await this.storeHeaderIds(job.data.batchId, failedToDeleteHeaders);
        }
        await this.jobs.resetAfterRollback(
          jobId,
          created.map((header) => header.headerKey),
          failedToDeleteHeaders,
        );
      } else {
        await this.jobs.resetAfterRollback(jobId, []);
      }
      throw error;
    }
  }

  private async createAndTrackHeader(
    strategy: IDfoPostingStrategy,
    headerRequest: unknown,
    created: RoutedCreatedHeader[],
    jobId: string,
    groupIndex: number,
    dataAreaId: string,
    route?: CashJournalRoute,
  ): Promise<string> {
    const result = await strategy.postHeadersInBatches([headerRequest], 1);
    if (result.headerIds.length !== 1 || !result.headerIds[0]?.trim()) {
      throw new Error('D365FO did not return one payment header ID');
    }

    const headerId = result.headerIds[0];
    // Track the D365 header before persisting its ID so a Mongo failure can
    // still roll the external header back.
    const trackedHeader: RoutedCreatedHeader = {
      headerKey: headerId,
      dataAreaId,
      route,
      persisted: false,
    };
    created.push(trackedHeader);
    await this.jobs.setCreatedHeader(jobId, groupIndex, headerId);
    trackedHeader.persisted = true;
    return headerId;
  }

  private isMissingPersistedHeaderError(
    error: unknown,
    headerId: string,
  ): boolean {
    const message = dfoErrorMessage(error).toLowerCase();
    return (
      message.includes('journal') &&
      message.includes(headerId.toLowerCase()) &&
      (message.includes('was not found') || message.includes('does not exist'))
    );
  }

  private asRoutedGroup(
    group: CashJournalPostingGroup,
  ): RoutedCashJournalPostingGroup | undefined {
    if (!('route' in group) || !group.route) return undefined;
    return group;
  }

  private selectStrategy(
    routedGroup: RoutedCashJournalPostingGroup | undefined,
    legacyDirection: 'in' | 'out',
  ): IDfoPostingStrategy {
    if (routedGroup) {
      this.cashJournalStrategy.setRouteContext(routedGroup.route);
      return this.cashJournalStrategy;
    }

    // Backward compatibility for durable jobs created before task 2045.
    this.strategy.setHeaderCashDirectionContext(legacyDirection);
    return this.strategy;
  }

  private async rollbackCreatedHeaders(
    created: RoutedCreatedHeader[],
    collector: PostingErrorCollector,
    legacyDirection: 'in' | 'out',
  ): Promise<string[]> {
    const failedToDeleteHeaders: string[] = [];

    for (const header of [...created].reverse()) {
      let strategy: IDfoPostingStrategy;
      if (header.route) {
        this.cashJournalStrategy.setRouteContext(header.route);
        strategy = this.cashJournalStrategy;
      } else {
        this.strategy.setHeaderCashDirectionContext(legacyDirection);
        strategy = this.strategy;
      }
      const result = await this.rollback.rollbackAll(
        strategy,
        [header],
        ROLLBACK_CHUNK_SIZE,
        collector,
      );
      failedToDeleteHeaders.push(...result.failedToDeleteHeaders);
    }

    return failedToDeleteHeaders;
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
      message: `Customer payment job ${status}`,
      context: PostCustomerPaymentJournalDFOProcessor.name,
      eventType,
      status,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : undefined,
    });
  }
}
