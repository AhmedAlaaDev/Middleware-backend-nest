import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';
import { QueueService } from '@/modules/queue/services/queue.service';

@Injectable()
export class QueueRecoveryService implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: QueueJobStoreService,
    private readonly queues: QueueService,
    private readonly logs: OperationalLoggerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const jobs = await this.jobs.listRecoverable();
    for (const job of jobs) {
      const restored = await this.queues.restoreDurableJob({
        ...job,
        sourceModule: job.sourceModule as 'AR' | 'VENDOR' | 'CASH' | 'Ledger',
        journalKind: job.journalKind as 'invoice' | 'payment' | undefined,
        cashDirection: job.cashDirection as 'in' | 'out' | undefined,
      });
      if (!restored) continue;
      await this.logs.emit({
        level: 'warn',
        message: `Reconciled durable queue job ${job.jobId}`,
        context: QueueRecoveryService.name,
        eventType: 'queue.job.recovered',
        batchId: job.batchId,
        jobId: job.jobId,
        queueName: job.queueName,
        correlationId: job.correlationId,
        status: job.status,
      });
    }
  }
}
