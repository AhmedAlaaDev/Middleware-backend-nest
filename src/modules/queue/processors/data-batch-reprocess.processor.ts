import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import { DataBatchImportJobPayload } from '@/modules/queue/contracts/data-batch-import-job.contract';
import { DataBatchReprocessJobPayload } from '@/modules/queue/contracts/data-batch-reprocess-job.contract';

@Processor(QUEUES.DATA_BATCH_REPROCESS, { concurrency: 1 })
export class DataBatchReprocessProcessor extends WorkerHost {
  constructor(
    private readonly batches: DataBatchService,
    private readonly logs: OperationalLoggerService,
    private readonly traceContext: TraceContextService,
  ) {
    super();
  }

  public process(
    job: Job<DataBatchReprocessJobPayload | DataBatchImportJobPayload>,
  ): Promise<void> {
    if (job.name === 'import-data-batch') {
      return this.traceContext.run(
        {
          correlationId: job.data.correlationId,
          batchId: job.data.batchId,
          jobId: String(job.id),
          queueName: QUEUES.DATA_BATCH_REPROCESS,
          userId: job.data.userId,
          userName: job.data.userName,
          userEmail: job.data.userEmail,
        },
        () => this.import(job as Job<DataBatchImportJobPayload>),
      );
    }

    return this.traceContext.run(
      {
        correlationId: job.data.correlationId,
        batchId: job.data.batchId,
        jobId: String(job.id),
        queueName: QUEUES.DATA_BATCH_REPROCESS,
        userId: job.data.userId,
        userName: job.data.userName,
        userEmail: job.data.userEmail,
      },
      () => this.reprocess(job as Job<DataBatchReprocessJobPayload>),
    );
  }

  private async import(job: Job<DataBatchImportJobPayload>): Promise<void> {
    await this.emitImport(job, 'active');
    try {
      await this.batches.processDeferredImportAsync(
        job.data.batchId,
        job.data.voucherNumberSettingLogicalName,
      );
      await this.emitImport(job, 'completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.batches.markProcessingImportFailedAsync(job.data.batchId, message);
      await this.emitImport(job, 'failed', message);
      throw error;
    }
  }

  private async reprocess(
    job: Job<DataBatchReprocessJobPayload>,
  ): Promise<void> {
    await this.batches.updateReprocessStatus(job.data.batchId, 'active');
    await this.emit(job, 'active');
    try {
      await this.batches.reprocessBatchAsync(job.data.batchId);
      await this.batches.updateReprocessStatus(job.data.batchId, 'completed');
      await this.emit(job, 'completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.batches.updateReprocessStatus(
        job.data.batchId,
        'failed',
        message,
      );
      await this.emit(job, 'failed', message);
      throw error;
    }
  }

  private emitImport(
    job: Job<DataBatchImportJobPayload>,
    status: string,
    error?: string,
  ): Promise<void> {
    return this.logs.emit({
      level: error ? 'error' : 'info',
      message: `Batch import job ${status}`,
      context: DataBatchReprocessProcessor.name,
      eventType: `batch.import.${status}`,
      status,
      batchId: job.data.batchId,
      jobId: String(job.id),
      queueName: QUEUES.DATA_BATCH_REPROCESS,
      userId: job.data.userId,
      error: error ? { message: error } : undefined,
    });
  }

  private emit(
    job: Job<DataBatchReprocessJobPayload>,
    status: string,
    error?: string,
  ): Promise<void> {
    return this.logs.emit({
      level: error ? 'error' : 'info',
      message: `Batch reprocess job ${status}`,
      context: DataBatchReprocessProcessor.name,
      eventType: `batch.reprocess.${status}`,
      status,
      batchId: job.data.batchId,
      jobId: String(job.id),
      queueName: QUEUES.DATA_BATCH_REPROCESS,
      userId: job.data.userId,
      error: error ? { message: error } : undefined,
    });
  }
}
