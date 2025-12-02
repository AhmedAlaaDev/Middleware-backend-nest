import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { ExampleJobData } from '../processors/example.processor';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue('example-queue')
    private readonly exampleQueue: Queue,
  ) {}

  /**
   * Add a job to the example queue
   */
  async addExampleJob(data: ExampleJobData, options?: { delay?: number; priority?: number }) {
    const job = await this.exampleQueue.add('process-example', data, {
      attempts: 3, // Retry 3 times on failure
      backoff: {
        type: 'exponential',
        delay: 2000, // Start with 2 second delay
      },
      removeOnComplete: {
        age: 24 * 3600, // Keep completed jobs for 24 hours
        count: 1000, // Keep last 1000 completed jobs
      },
      removeOnFail: {
        age: 7 * 24 * 3600, // Keep failed jobs for 7 days
      },
      ...options,
    });

    this.logger.log(`Added job ${job.id} to example-queue`);
    return job;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.exampleQueue.getWaitingCount(),
      this.exampleQueue.getActiveCount(),
      this.exampleQueue.getCompletedCount(),
      this.exampleQueue.getFailedCount(),
      this.exampleQueue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string) {
    return this.exampleQueue.getJob(jobId);
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string) {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    return job.retry();
  }

  /**
   * Remove a job
   */
  async removeJob(jobId: string) {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    return job.remove();
  }

  /**
   * Clean old jobs
   */
  async cleanOldJobs(grace: number = 1000 * 60 * 60) {
    return this.exampleQueue.clean(grace, 1000, 'completed');
  }
}

