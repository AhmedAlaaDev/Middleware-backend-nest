import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, JobsOptions, Queue } from 'bullmq';

import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import {
  DataBatchReprocessJobPayload,
  DataBatchReprocessSubmission,
} from '@/modules/queue/contracts/data-batch-reprocess-job.contract';
import {
  DurableJobSubmissionStatus,
  DurablePostingJobPayload,
} from '@/modules/queue/contracts/durable-posting-job.contract';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
export interface DurableJobSubmission {
  job: Job;
  jobId: string;
  status: DurableJobSubmissionStatus;
  redisState: string;
  message: string;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUES.DFO_FREE_TEXT_INVOICE)
    private readonly dfoFreeTextInvoiceQueue: Queue,
    @InjectQueue(QUEUES.DFO_VENDOR_JOURNAL)
    private readonly dfoVendorJournalQueue: Queue,
    @InjectQueue(QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL)
    private readonly dfoCustomerPaymentJournalQueue: Queue,
    @InjectQueue(QUEUES.DFO_LEDGER_JOURNAL)
    private readonly dfoLedgerJournalQueue: Queue,
    @InjectQueue(QUEUES.MASTER_DATA_SYNC)
    private readonly masterDataSyncQueue: Queue,
    @InjectQueue(QUEUES.DATA_BATCH_REPROCESS)
    private readonly dataBatchReprocessQueue: Queue,
    private readonly jobStore: QueueJobStoreService,
    private readonly operationalLogs: OperationalLoggerService,
    private readonly traceContext: TraceContextService,
  ) {}

  /** 🧠 Helper to return the Queue instance dynamically */
  public getQueue(queueName: QueueName): Queue {
    switch (queueName) {
      case QUEUES.DFO_FREE_TEXT_INVOICE:
        return this.dfoFreeTextInvoiceQueue;
      case QUEUES.DFO_VENDOR_JOURNAL:
        return this.dfoVendorJournalQueue;
      case QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL:
        return this.dfoCustomerPaymentJournalQueue;
      case QUEUES.DFO_LEDGER_JOURNAL:
        return this.dfoLedgerJournalQueue;
      case QUEUES.MASTER_DATA_SYNC:
        return this.masterDataSyncQueue;
      case QUEUES.DATA_BATCH_REPROCESS:
        return this.dataBatchReprocessQueue;
      default:
        throw new Error(`Queue is not registered`);
    }
  }

  /** ➕ Add Job */
  public async addJob(
    queueName: QueueName,
    jobName: string,
    data: any,
    options?: JobsOptions,
  ) {
    const queue = this.getQueue(queueName);
    const job = await queue.add(jobName, data, options);

    this.logger.log(
      `[QUEUE] Added job ${job.id} (${jobName}) to queue ${queueName}`,
    );
    return job;
  }

  public async addDurableJob(
    queueName: QueueName,
    jobName: string,
    metadata: Omit<DurablePostingJobPayload, 'correlationId'> & {
      correlationId?: string;
    },
    groups: unknown[],
  ): Promise<DurableJobSubmission> {
    const correlationId =
      metadata.correlationId ??
      this.traceContext.get()?.correlationId ??
      metadata.batchId;
    const jobId = `${queueName}--${metadata.batchId}`;
    const queue = this.getQueue(queueName);
    const existingJob = await queue.getJob(jobId);

    const durableJob = {
      ...metadata,
      correlationId,
      jobId,
      queueName,
      jobName,
      groups,
    };

    if (existingJob) {
      const state = await existingJob.getState();
      if (state !== 'failed') {
        const status =
          state === 'completed' ? 'already-completed' : 'already-running';
        await this.emitDuplicateSubmission(
          metadata.batchId,
          jobId,
          queueName,
          correlationId,
          status,
          state,
        );
        return {
          job: existingJob,
          jobId,
          status,
          redisState: state,
          message:
            status === 'already-completed'
              ? `Batch ${metadata.batchId} was already posted to D365FO. Existing job ID: ${jobId}`
              : `Batch ${metadata.batchId} is already being processed. Existing job ID: ${jobId}`,
        };
      }

      await existingJob.remove();
      await this.jobStore.replace(durableJob);
    } else {
      await this.jobStore.prepare(durableJob);
    }

    const payload: DurablePostingJobPayload = {
      batchId: metadata.batchId,
      company: metadata.company,
      correlationId,
      sourceModule: metadata.sourceModule,
      payloadVersion: metadata.payloadVersion,
      journalKind: metadata.journalKind,
      cashDirection: metadata.cashDirection,
    };
    const job = await queue.add(jobName, payload, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 5000 },
    });

    const submissionStatus = existingJob ? 'requeued' : 'queued';
    await this.operationalLogs.emit({
      level: 'info',
      message:
        submissionStatus === 'requeued'
          ? `Requeued durable job ${jobId}`
          : `Queued durable job ${jobId}`,
      context: QueueService.name,
      eventType:
        submissionStatus === 'requeued'
          ? 'queue.job.requeued'
          : 'queue.job.queued',
      batchId: metadata.batchId,
      jobId,
      queueName,
      correlationId,
      status: submissionStatus,
      metadata: { groupCount: groups.length, jobName },
    });
    return {
      job,
      jobId,
      status: submissionStatus,
      redisState: 'waiting',
      message: existingJob
        ? `Batch ${metadata.batchId} requeued for posting to D365FO. Job ID: ${jobId}`
        : `Batch ${metadata.batchId} queued for posting to D365FO. Job ID: ${jobId}`,
    };
  }

  public async enqueueBatchReprocess(
    payload: Omit<DataBatchReprocessJobPayload, 'correlationId'>,
  ): Promise<DataBatchReprocessSubmission> {
    const jobId = `${QUEUES.DATA_BATCH_REPROCESS}--${payload.batchId}`;
    const existingJob = await this.dataBatchReprocessQueue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (['waiting', 'active', 'delayed', 'paused'].includes(state)) {
        return {
          jobId,
          status: 'already-running',
          message: 'This batch already has a reprocess job queued or running.',
        };
      }
      await existingJob.remove();
    }

    const correlationId =
      this.traceContext.get()?.correlationId ?? payload.batchId;
    await this.dataBatchReprocessQueue.add(
      'reprocess-data-batch',
      { ...payload, correlationId },
      {
        jobId,
        attempts: 1,
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
        removeOnFail: { age: 30 * 24 * 60 * 60, count: 5000 },
      },
    );
    return {
      jobId,
      status: 'queued',
      message: `Batch ${payload.batchId} queued for reprocessing.`,
    };
  }

  public async findActiveJobsForBatch(batchId: string): Promise<string[]> {
    const queues = Object.values(QUEUES).map((queueName) =>
      this.getQueue(queueName),
    );
    const jobs = (
      await Promise.all(
        queues.map((queue) =>
          queue.getJobs(['waiting', 'active', 'delayed', 'paused']),
        ),
      )
    ).flat();
    return jobs
      .filter((job) => job.data?.batchId === batchId)
      .map((job) => String(job.id));
  }

  private emitDuplicateSubmission(
    batchId: string,
    jobId: string,
    queueName: QueueName,
    correlationId: string,
    status: Extract<
      DurableJobSubmissionStatus,
      'already-running' | 'already-completed'
    >,
    redisState: string,
  ): Promise<void> {
    return this.operationalLogs.emit({
      level: 'info',
      message:
        status === 'already-completed'
          ? `Ignored duplicate submission for completed job ${jobId}`
          : `Ignored duplicate submission for running job ${jobId}`,
      context: QueueService.name,
      eventType: 'queue.job.duplicate_ignored',
      batchId,
      jobId,
      queueName,
      correlationId,
      status,
      metadata: { redisState },
    });
  }

  async restoreDurableJob(job: {
    jobId: string;
    queueName: string;
    jobName: string;
    batchId: string;
    company: string;
    correlationId: string;
    sourceModule: DurablePostingJobPayload['sourceModule'];
    payloadVersion: number;
    journalKind?: DurablePostingJobPayload['journalKind'];
    cashDirection?: DurablePostingJobPayload['cashDirection'];
  }): Promise<boolean> {
    const queueName = job.queueName as QueueName;
    if (await this.getJob(queueName, job.jobId)) return false;
    if (job.payloadVersion !== 1 && job.payloadVersion !== 2) {
      throw new Error(
        `Unsupported durable posting payload version ${job.payloadVersion}`,
      );
    }

    await this.getQueue(queueName).add(
      job.jobName,
      {
        batchId: job.batchId,
        company: job.company,
        correlationId: job.correlationId,
        sourceModule: job.sourceModule,
        payloadVersion: job.payloadVersion,
        journalKind: job.journalKind,
        cashDirection: job.cashDirection,
      } satisfies DurablePostingJobPayload,
      {
        jobId: job.jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
        removeOnFail: { age: 30 * 24 * 60 * 60, count: 5000 },
      },
    );
    return true;
  }

  /** 📊 Queue Stats */
  public async getStats(queueName: QueueName) {
    const q = this.getQueue(queueName);

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getCompletedCount(),
      q.getFailedCount(),
      q.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  public getQueueNames(): QueueName[] {
    return Object.values(QUEUES);
  }

  /** 🔍 Get Job */
  public getJob(queueName: QueueName, jobId: string) {
    return this.getQueue(queueName).getJob(jobId);
  }

  /** 🔄 Retry Job */
  public async retryJob(queueName: QueueName, jobId: string) {
    const job = await this.getJob(queueName, jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    return job.retry();
  }

  /** ❌ Remove Job */
  public async removeJob(queueName: QueueName, jobId: string) {
    const job = await this.getJob(queueName, jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    return job.remove();
  }

  /** 🗑️ Clean Old Jobs */
  public cleanOldJobs(queueName: QueueName, grace: number = 1000 * 60 * 60) {
    return this.getQueue(queueName).clean(grace, 1000, 'completed');
  }
}
