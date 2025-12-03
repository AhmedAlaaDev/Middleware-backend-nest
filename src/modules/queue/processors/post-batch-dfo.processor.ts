import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { QUEUES } from '@/modules/queue/constants/queues';

export interface PostBatchDFOJobData {
  batchId: string;
  company: string;
  entryProcessorName: string;
}

@Processor(QUEUES.POST_BATCH_DFO, {
  concurrency: 3, // Process 5 jobs concurrently
})
export class PostBatchDFOProcessor extends WorkerHost {
  private readonly logger = new Logger(PostBatchDFOProcessor.name);

  public async process(job: Job<PostBatchDFOJobData>): Promise<void> {
    this.logger.log(`Processing DFO job ${job.id}`);

    try {
      await this.postToD365FO(job.data);

      this.logger.log(`Job ${job.id} completed`);
    } catch (error) {
      this.logger.error(`Job ${job.id} failed: ${error.message}`);
      throw error;
    }
  }

  private async postToD365FO(data: PostBatchDFOJobData) {
    // call external API, processing logic...
    await new Promise((resolve) => setTimeout(resolve, 2000));
    this.logger.debug(`Posted batch ${data.batchId}`);
  }
}
