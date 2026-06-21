import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { dfoErrorMessage } from '@/modules/d365fo/errors/dfo-api.error';
import { LedgerJournalLineRequest } from '@/modules/d365fo/types/d365fo-ledger.type';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import {
  LedgerJournalPostingGroup,
  PostLedgerJournalDFOJobPayload,
} from '@/modules/queue/contracts/post-ledger-journal-dfo-job.contract';
import { QueueJobGroupStatus } from '@/modules/queue/schemas/queue-job-group.schema';
import {
  CreatedHeader,
  DfoRollbackService,
} from '@/modules/queue/services/dfo-rollback.service';
import { PostingErrorCollector } from '@/modules/queue/services/posting-error-collector.service';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';
import { LedgerJournalPostingStrategy } from '@/modules/queue/strategies/ledger-journal-posting.strategy';

const LINE_CHUNK_SIZE = 20;
const ROLLBACK_CHUNK_SIZE = 20;

@Processor(QUEUES.DFO_LEDGER_JOURNAL, { concurrency: 1 })
export class PostLedgerJournalDFOProcessor extends WorkerHost {
  private readonly logger = new Logger(PostLedgerJournalDFOProcessor.name);

  constructor(
    private readonly strategy: LedgerJournalPostingStrategy,
    private readonly dataBatchService: DataBatchService,
    private readonly dfoRollbackService: DfoRollbackService,
    private readonly jobStore: QueueJobStoreService,
    private readonly operationalLogs: OperationalLoggerService,
    private readonly traceContext: TraceContextService,
  ) {
    super();
  }

  process(job: Job<PostLedgerJournalDFOJobPayload>): Promise<void> {
    return this.traceContext.run(
      {
        correlationId: job.data.correlationId,
        batchId: job.data.batchId,
        jobId: String(job.id),
        queueName: QUEUES.DFO_LEDGER_JOURNAL,
      },
      () => this.processJob(job),
    );
  }

  private async processJob(
    job: Job<PostLedgerJournalDFOJobPayload>,
  ): Promise<void> {
    const jobId = String(job.id);
    const errorCollector = new PostingErrorCollector();
    const legacyGroups = (
      job.data as PostLedgerJournalDFOJobPayload & {
        groupedJournals?: LedgerJournalPostingGroup[];
      }
    ).groupedJournals;
    if (legacyGroups?.length) {
      await this.jobStore.prepare({
        ...job.data,
        correlationId: job.data.correlationId ?? job.data.batchId,
        payloadVersion: 1,
        jobId,
        queueName: QUEUES.DFO_LEDGER_JOURNAL,
        jobName: job.name,
        groups: legacyGroups,
      });
    }
    await this.jobStore.markActive(jobId, job.attemptsMade);
    await this.emitLifecycle('queue.job.active', 'active', jobId);

    try {
      await this.executePosting(job, errorCollector);
      await this.jobStore.markCompleted(jobId);
      await this.emitLifecycle('queue.job.completed', 'completed', jobId);
    } catch (error) {
      const message = dfoErrorMessage(error);
      errorCollector.addHeaderError(message, 'Job processing');
      const finalAttempt = this.isFinalAttempt(job);

      if (finalAttempt) {
        await this.jobStore.markFailed(jobId, message);
        await this.handlePostingFailure(job.data.batchId, errorCollector);
      } else {
        await this.jobStore.markRetrying(jobId, message);
      }
      await this.emitLifecycle(
        finalAttempt ? 'queue.job.failed' : 'queue.job.retrying',
        finalAttempt ? 'failed' : 'retrying',
        jobId,
        error,
      );
      throw error;
    }
  }

  private async executePosting(
    job: Job<PostLedgerJournalDFOJobPayload>,
    errorCollector: PostingErrorCollector,
  ): Promise<void> {
    const { batchId, company } = job.data;
    const jobId = String(job.id);
    const groups =
      await this.jobStore.listGroups<LedgerJournalPostingGroup>(jobId);
    if (!groups.length) throw new Error('No durable journal groups found');

    const createdHeaders: CreatedHeader[] = [];
    try {
      for (const record of groups) {
        if (record.status === QueueJobGroupStatus.COMPLETED) continue;
        await this.jobStore.markGroupActive(jobId, record.index);

        let headerKey = record.createdHeaderId;
        if (!headerKey) {
          const result = await this.strategy.postHeadersInBatches(
            [record.payload.header],
            1,
          );
          if (result.headerIds.length !== 1) {
            throw new Error(
              `Expected 1 header ID, got ${result.headerIds.length}`,
            );
          }
          headerKey = result.headerIds[0];
          await this.jobStore.setCreatedHeader(jobId, record.index, headerKey);
        }
        createdHeaders.push({ headerKey, dataAreaId: company });

        const lines = record.payload.lines.map(
          (line: LedgerJournalLineRequest) => ({
            ...line,
            JournalBatchNumber: headerKey,
            dataAreaId: company,
          }),
        );
        await this.strategy.postLinesForHeader(
          headerKey,
          lines,
          company,
          LINE_CHUNK_SIZE,
        );
        await this.jobStore.completeGroup(jobId, record.index);
        await job.updateProgress({
          completedGroups: record.index + 1,
          totalGroups: groups.length,
        });
      }

      await this.handlePostingSuccess(
        batchId,
        groups
          .map((group) => group.createdHeaderId)
          .filter((id): id is string => Boolean(id))
          .concat(createdHeaders.map((header) => header.headerKey)),
      );
    } catch (error) {
      if (createdHeaders.length) {
        const rollback = await this.dfoRollbackService.rollbackAll(
          this.strategy,
          createdHeaders,
          ROLLBACK_CHUNK_SIZE,
          errorCollector,
        );
        if (rollback.failedToDeleteHeaders.length) {
          await this.storeCreatedHeaderIds(
            batchId,
            rollback.failedToDeleteHeaders,
          );
        }
        await this.jobStore.resetAfterRollback(
          jobId,
          createdHeaders.map((header) => header.headerKey),
          rollback.failedToDeleteHeaders,
        );
      }
      throw error;
    }
  }

  private async handlePostingFailure(
    batchId: string,
    errors: PostingErrorCollector,
  ): Promise<void> {
    await this.dataBatchService.updateDfoPostingErrorsAsync(
      batchId,
      errors.getFormattedErrorMessages(),
    );
    await this.dataBatchService.updateStatusAsync(
      batchId,
      DataBatchStatus.Canceled,
    );
  }

  private async handlePostingSuccess(
    batchId: string,
    headerIds: string[],
  ): Promise<void> {
    await this.storeCreatedHeaderIds(batchId, headerIds);
    await this.dataBatchService.clearDfoPostingErrorsAsync(batchId);
    await this.dataBatchService.updateStatusAsync(
      batchId,
      DataBatchStatus.Posted,
    );
  }

  private async storeCreatedHeaderIds(
    batchId: string,
    headerIds: string[],
  ): Promise<void> {
    if (!headerIds.length) return;
    const batch = await this.dataBatchService.getByIdAsync(batchId);
    await this.dataBatchService.updateDfoIdsAsync(batchId, [
      ...new Set([...(batch?.dfoIds ?? []), ...headerIds]),
    ]);
  }

  private isFinalAttempt(job: Job): boolean {
    return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  }

  private emitLifecycle(
    eventType: string,
    status: string,
    jobId: string,
    error?: unknown,
  ): Promise<void> {
    return this.operationalLogs.emit({
      level: error ? 'error' : 'info',
      message: `Ledger journal job ${jobId} ${status}`,
      context: PostLedgerJournalDFOProcessor.name,
      eventType,
      status,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : undefined,
    });
  }
}
