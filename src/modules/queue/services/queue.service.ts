import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';

import { QUEUES } from '@/modules/queue/constants/queues';

type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUES.DFO_FREE_TEXT_INVOICE)
    private readonly dfoFreeTextInvoiceQueue: Queue,
    @InjectQueue(QUEUES.DFO_VENDOR_JOURNAL)
    private readonly dfoVendorJournalQueue: Queue,
    @InjectQueue(QUEUES.DFO_LEDGER_JOURNAL)
    private readonly dfoLedgerJournalQueue: Queue,
    @InjectQueue(QUEUES.MASTER_DATA_SYNC)
    private readonly masterDataSyncQueue: Queue,
  ) {}

  /** 🧠 Helper to return the Queue instance dynamically */
  private getQueue(queueName: QueueName): Queue {
    switch (queueName) {
      case QUEUES.DFO_FREE_TEXT_INVOICE:
        return this.dfoFreeTextInvoiceQueue;
      case QUEUES.DFO_VENDOR_JOURNAL:
        return this.dfoVendorJournalQueue;
      case QUEUES.DFO_LEDGER_JOURNAL:
        return this.dfoLedgerJournalQueue;
      case QUEUES.MASTER_DATA_SYNC:
        return this.masterDataSyncQueue;
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
