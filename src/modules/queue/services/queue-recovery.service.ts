import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';
import {
  QueueName,
  QueueService,
} from '@/modules/queue/services/queue.service';

@Injectable()
export class QueueRecoveryService implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: QueueJobStoreService,
    private readonly queues: QueueService,
    private readonly logs: OperationalLoggerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.reconcile();
  }

  /**
   * Release Redis active locks that no longer match a running Mongo job, then
   * put durable queued/active/retrying jobs back on Redis if they are missing.
   */
  async reconcile(queueName?: QueueName): Promise<{
    released: Array<{
      queueName: string;
      jobId: string;
      batchId?: string;
      mongoStatus: string;
    }>;
    restored: string[];
  }> {
    const queueNames = queueName
      ? [queueName]
      : (Object.values(QUEUES) as QueueName[]);
    const released: Array<{
      queueName: string;
      jobId: string;
      batchId?: string;
      mongoStatus: string;
    }> = [];
    const restored: string[] = [];

    for (const name of queueNames) {
      const orphans = await this.queues.releaseOrphanedActiveJobs(name);
      for (const orphan of orphans) {
        released.push({ queueName: name, ...orphan });
        await this.logs.emit({
          level: 'warn',
          message: `Released orphaned Redis active job ${orphan.jobId} (mongo=${orphan.mongoStatus})`,
          context: QueueRecoveryService.name,
          eventType: 'queue.job.orphan_released',
          batchId: orphan.batchId,
          jobId: orphan.jobId,
          queueName: name,
          status: orphan.mongoStatus,
        });
      }
    }

    const jobs = await this.jobs.listRecoverable();
    for (const job of jobs) {
      if (queueName && job.queueName !== queueName) continue;
      const wasRestored = await this.queues.restoreDurableJob({
        ...job,
        sourceModule: job.sourceModule as 'AR' | 'VENDOR' | 'CASH' | 'Ledger',
        journalKind: job.journalKind as 'invoice' | 'payment' | undefined,
        cashDirection: job.cashDirection as 'in' | 'out' | undefined,
      });
      if (!wasRestored) continue;
      restored.push(job.jobId);
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

    return { released, restored };
  }
}
