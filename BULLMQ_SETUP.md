# BullMQ Setup Guide

This guide explains how to use BullMQ (job queue) with Redis in this NestJS project.

## Overview

BullMQ is a powerful job queue library for Node.js that uses Redis as its backend. It's perfect for handling background jobs, scheduled tasks, and processing queues.

## Configuration

### Environment Variables

Add the following Redis configuration to your `.env.development` and `.env.production` files:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_MAX_RETRIES_PER_REQUEST=3
REDIS_ENABLE_READY_CHECK=true
REDIS_LAZY_CONNECT=false
```

### Docker Configuration

When using Docker, Redis is automatically configured. The connection will use:
- **Host**: `redis` (service name in docker-compose)
- **Port**: `6379`
- **Password**: Set via `REDIS_PASSWORD` environment variable (optional)

## Project Structure

```
src/modules/queue/
├── queue.module.ts          # Main queue module
├── queue.controller.ts      # REST API for queue operations
├── processors/
│   └── example.processor.ts # Example job processor
└── services/
    └── queue.service.ts     # Queue service for adding/managing jobs
```

## Usage Examples

### 1. Adding Jobs to Queue

```typescript
import { Injectable } from '@nestjs/common';
import { QueueService } from '@/modules/queue/services/queue.service';

@Injectable()
export class YourService {
  constructor(private readonly queueService: QueueService) {}

  async processData(data: any) {
    // Add a job to the queue
    const job = await this.queueService.addExampleJob({
      message: 'Process this data',
      userId: 'user123',
      metadata: { ...data },
    });

    return job.id;
  }
}
```

### 2. Creating a Custom Queue Processor

Create a new processor in `src/modules/queue/processors/`:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

export interface YourJobData {
  // Define your job data structure
  data: any;
}

@Processor('your-queue-name', {
  concurrency: 5, // Process 5 jobs concurrently
})
export class YourProcessor extends WorkerHost {
  private readonly logger = new Logger(YourProcessor.name);

  async process(job: Job<YourJobData>): Promise<void> {
    this.logger.log(`Processing job ${job.id}`);

    try {
      // Your business logic here
      await this.processJob(job.data);

      // Update job progress
      await job.updateProgress(100);

      this.logger.log(`Job ${job.id} completed`);
    } catch (error) {
      this.logger.error(`Job ${job.id} failed: ${error.message}`);
      throw error;
    }
  }

  private async processJob(data: YourJobData['data']): Promise<void> {
    // Process the job data
  }
}
```

### 3. Registering a New Queue

Update `src/modules/queue/queue.module.ts`:

```typescript
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    // ... existing BullModule.forRootAsync ...
    
    // Register your new queue
    BullModule.registerQueue({
      name: 'your-queue-name',
    }),
  ],
  providers: [
    YourProcessor, // Add your processor
    // ... other providers
  ],
})
export class QueueModule {}
```

### 4. Adding Jobs with Options

```typescript
// Add job with delay
await queueService.addExampleJob(
  { message: 'Delayed job' },
  { delay: 5000 } // 5 seconds delay
);

// Add job with priority
await queueService.addExampleJob(
  { message: 'High priority job' },
  { priority: 1 } // Higher priority
);
```

## API Endpoints

The queue controller provides REST API endpoints:

### Add Job
```http
POST /v1/queue/example
Content-Type: application/json

{
  "message": "Process this",
  "userId": "user123"
}
```

### Get Queue Statistics
```http
GET /v1/queue/stats
```

### Get Job Details
```http
GET /v1/queue/job/:jobId
```

### Retry Failed Job
```http
POST /v1/queue/job/:jobId/retry
```

### Remove Job
```http
DELETE /v1/queue/job/:jobId
```

## Job Options

When adding jobs, you can configure:

- **attempts**: Number of retry attempts (default: 3)
- **backoff**: Retry strategy (exponential, fixed, etc.)
- **delay**: Delay before processing (milliseconds)
- **priority**: Job priority (higher = more priority)
- **removeOnComplete**: Auto-remove completed jobs
- **removeOnFail**: Auto-remove failed jobs

## Monitoring

### Using BullMQ Dashboard (Optional)

You can add the BullMQ dashboard for visual monitoring:

```bash
pnpm add @bull-board/api @bull-board/express
```

Then create a dashboard module to view queues and jobs in real-time.

### Queue Statistics

Use the `/v1/queue/stats` endpoint to get:
- Waiting jobs count
- Active jobs count
- Completed jobs count
- Failed jobs count
- Delayed jobs count

## Best Practices

1. **Error Handling**: Always wrap job processing in try-catch
2. **Idempotency**: Make jobs idempotent (safe to retry)
3. **Progress Updates**: Use `job.updateProgress()` for long-running jobs
4. **Concurrency**: Set appropriate concurrency limits per processor
5. **Job Data**: Keep job data small; use references for large data
6. **Cleanup**: Configure `removeOnComplete` and `removeOnFail` appropriately

## Common Use Cases

### Background Email Sending
```typescript
@Processor('email-queue')
export class EmailProcessor extends WorkerHost {
  async process(job: Job<EmailJobData>) {
    await this.emailService.send(job.data);
  }
}
```

### Data Processing
```typescript
@Processor('data-processing-queue', { concurrency: 3 })
export class DataProcessor extends WorkerHost {
  async process(job: Job<DataJobData>) {
    await this.processLargeDataset(job.data);
  }
}
```

### Scheduled Tasks
```typescript
// Add job with delay for scheduling
await queueService.addExampleJob(
  { message: 'Scheduled task' },
  { delay: 24 * 60 * 60 * 1000 } // 24 hours
);
```

## Troubleshooting

### Redis Connection Issues

1. **Check Redis is running**:
   ```bash
   docker compose ps redis
   ```

2. **Check Redis logs**:
   ```bash
   docker compose logs redis
   ```

3. **Test Redis connection**:
   ```bash
   docker compose exec redis redis-cli ping
   ```

### Job Not Processing

1. Check processor is registered in `QueueModule`
2. Verify Redis connection
3. Check application logs for errors
4. Verify job data structure matches processor expectations

### Jobs Stuck in Active State

This usually means the worker crashed. Jobs will be automatically retried after the lock expires (default: 30 seconds).

## Resources

- [BullMQ Documentation](https://docs.bullmq.io/)
- [NestJS BullMQ Module](https://docs.nestjs.com/techniques/queues)
- [Redis Documentation](https://redis.io/docs/)


