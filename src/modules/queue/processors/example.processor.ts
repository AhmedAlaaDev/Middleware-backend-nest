import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

export interface ExampleJobData {
  message: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

@Processor('example-queue', {
  concurrency: 5, // Process 5 jobs concurrently
})
export class ExampleProcessor extends WorkerHost {
  private readonly logger = new Logger(ExampleProcessor.name);

  async process(job: Job<ExampleJobData>): Promise<void> {
    this.logger.log(`Processing job ${job.id} with data: ${JSON.stringify(job.data)}`);

    try {
      // Simulate some async work
      await this.processJobData(job.data);

      this.logger.log(`Job ${job.id} completed successfully`);
    } catch (error) {
      this.logger.error(`Job ${job.id} failed: ${error.message}`, error.stack);
      throw error; // Re-throw to mark job as failed
    }
  }

  private async processJobData(data: ExampleJobData): Promise<void> {
    // Your business logic here
    this.logger.debug(`Processing: ${data.message}`);
    
    // Simulate async operation
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}


