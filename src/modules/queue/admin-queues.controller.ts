import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { LogStreamService } from '@/modules/observability/services/log-stream.service';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';
import {
  QueueName,
  QueueService,
} from '@/modules/queue/services/queue.service';
import { UserRole } from '@/modules/user/schemas/user.schema';

@ApiBearerAuth()
@ApiTags('Admin Queues')
@Controller('admin/queues')
@Roles(UserRole.ADMIN)
export class AdminQueuesController {
  constructor(
    private readonly queues: QueueService,
    private readonly jobs: QueueJobStoreService,
    private readonly redis: LogStreamService,
  ) {}

  @Get()
  async list() {
    const stats = await Promise.all(
      this.queues.getQueueNames().map(async (queueName) => ({
        queueName,
        ...(await this.queues.getStats(queueName)),
      })),
    );
    return {
      queues: stats,
      jobs: await this.jobs.listRecent(),
      redis: await this.redis.getMetrics(),
    };
  }

  @Get(':queueName/jobs/:jobId')
  async get(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
  ) {
    const durableJob = await this.jobs.getJob(jobId);
    if (!this.queues.getQueueNames().includes(queueName as QueueName)) {
      throw new BadRequestException(`Unknown queue ${queueName}`);
    }
    const redisJob = await this.queues.getJob(queueName as QueueName, jobId);
    return {
      durableJob,
      redisState: redisJob ? await redisJob.getState() : 'missing',
      progress: redisJob?.progress ?? null,
      failedReason: redisJob?.failedReason ?? null,
    };
  }
}
