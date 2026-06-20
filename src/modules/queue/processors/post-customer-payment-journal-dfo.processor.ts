import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { DfoErrorExtractorService } from '@/modules/d365fo/services/dfo-error-extractor.service';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import {
  CustomerPaymentJournalPostingGroup,
  PostCustomerPaymentJournalDFOJobPayload,
} from '@/modules/queue/contracts/post-customer-payment-journal-dfo-job.contract';
import { QueueJobGroupStatus } from '@/modules/queue/schemas/queue-job-group.schema';
import {
  CreatedHeader,
  DfoRollbackService,
} from '@/modules/queue/services/dfo-rollback.service';
import { PostingErrorCollector } from '@/modules/queue/services/posting-error-collector.service';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';
import { CustomerPaymentJournalPostingStrategy } from '@/modules/queue/strategies/customer-payment-journal-posting.strategy';

const LINE_CHUNK_SIZE = 20;
const ROLLBACK_CHUNK_SIZE = 20;

@Processor(QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL, { concurrency: 1 })
export class PostCustomerPaymentJournalDFOProcessor extends WorkerHost {
  constructor(
    private readonly strategy: CustomerPaymentJournalPostingStrategy,
    private readonly batches: DataBatchService,
    private readonly rollback: DfoRollbackService,
    private readonly errors: DfoErrorExtractorService,
    private readonly jobs: QueueJobStoreService,
    private readonly logs: OperationalLoggerService,
    private readonly trace: TraceContextService,
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
        groupedJournals?: CustomerPaymentJournalPostingGroup[];
      }
    ).groupedJournals;
    if (legacyGroups?.length) {
      await this.jobs.prepare({
        ...job.data,
        correlationId: job.data.correlationId ?? job.data.batchId,
        payloadVersion: 1,
        jobId,
        queueName: QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL,
        jobName: job.name,
        groups: legacyGroups,
      });
    }
    await this.jobs.markActive(jobId, job.attemptsMade);
    await this.emit('queue.job.active', 'active');
    try {
      await this.postGroups(job, collector);
      await this.jobs.markCompleted(jobId);
      await this.emit('queue.job.completed', 'completed');
    } catch (error) {
      const message = this.errors.extractMessage(error);
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
  ): Promise<void> {
    const jobId = String(job.id);
    const groups =
      await this.jobs.listGroups<CustomerPaymentJournalPostingGroup>(jobId);
    if (!groups.length) throw new Error('No durable customer payment groups');
    const created: CreatedHeader[] = [];

    try {
      for (const record of groups) {
        if (record.status === QueueJobGroupStatus.COMPLETED) continue;
        await this.jobs.markGroupActive(jobId, record.index);
        this.strategy.setHeaderCashDirectionContext(
          job.data.cashDirection ?? 'in',
        );

        let headerId = record.createdHeaderId;
        if (!headerId) {
          const result = await this.strategy.postHeadersInBatches(
            [record.payload.header],
            1,
          );
          if (result.headerIds.length !== 1) {
            throw new Error('D365FO did not return one payment header ID');
          }
          headerId = result.headerIds[0];
          await this.jobs.setCreatedHeader(jobId, record.index, headerId);
        }
        created.push({ headerKey: headerId, dataAreaId: job.data.company });
        await this.strategy.postLinesForHeader(
          headerId,
          record.payload.lines,
          job.data.company,
          LINE_CHUNK_SIZE,
        );
        await this.jobs.completeGroup(jobId, record.index);
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
    } catch (error) {
      if (created.length) {
        const result = await this.rollback.rollbackAll(
          this.strategy,
          created,
          ROLLBACK_CHUNK_SIZE,
          collector,
        );
        if (result.failedToDeleteHeaders.length) {
          await this.storeHeaderIds(
            job.data.batchId,
            result.failedToDeleteHeaders,
          );
        }
        await this.jobs.resetAfterRollback(
          jobId,
          created.map((header) => header.headerKey),
          result.failedToDeleteHeaders,
        );
      } else {
        await this.jobs.resetAfterRollback(jobId, []);
      }
      throw error;
    }
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
