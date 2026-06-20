import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { LogStreamService } from '@/modules/observability/services/log-stream.service';
import { QueueJobsQueryDto } from '@/modules/queue/dto/queue-jobs-query.dto';
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
      this.queues.getQueueNames().map(async (queueName) => {
        const queueStats = await this.queues.getStats(queueName);
        const queue = this.queues.getQueue(queueName);
        const isPaused = await queue.isPaused();
        return {
          queueName,
          ...queueStats,
          isPaused,
        };
      }),
    );
    return {
      queues: stats,
      jobs: await this.jobs.listRecent(),
      redis: await this.redis.getMetrics(),
    };
  }

  @Get(':queueName')
  async getQueueInfo(@Param('queueName') queueName: string) {
    if (!this.queues.getQueueNames().includes(queueName as QueueName)) {
      throw new BadRequestException(`Unknown queue ${queueName}`);
    }
    const stats = await this.queues.getStats(queueName as QueueName);
    const queue = this.queues.getQueue(queueName as QueueName);
    const isPaused = await queue.isPaused();
    return {
      queueName,
      stats,
      isPaused,
    };
  }

  @Post(':queueName/pause')
  async pauseQueue(@Param('queueName') queueName: string) {
    if (!this.queues.getQueueNames().includes(queueName as QueueName)) {
      throw new BadRequestException(`Unknown queue ${queueName}`);
    }
    const queue = this.queues.getQueue(queueName as QueueName);
    await queue.pause();
    return { status: 'paused' };
  }

  @Post(':queueName/resume')
  async resumeQueue(@Param('queueName') queueName: string) {
    if (!this.queues.getQueueNames().includes(queueName as QueueName)) {
      throw new BadRequestException(`Unknown queue ${queueName}`);
    }
    const queue = this.queues.getQueue(queueName as QueueName);
    await queue.resume();
    return { status: 'resumed' };
  }

  @Get(':queueName/jobs')
  async listJobs(
    @Param('queueName') queueName: string,
    @Query() filters: QueueJobsQueryDto,
  ) {
    if (!this.queues.getQueueNames().includes(queueName as QueueName)) {
      throw new BadRequestException(`Unknown queue ${queueName}`);
    }
    return this.jobs.listQueueJobs(queueName, filters);
  }

  @Get(':queueName/jobs/:jobId')
  async get(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
  ) {
    if (!this.queues.getQueueNames().includes(queueName as QueueName)) {
      throw new BadRequestException(`Unknown queue ${queueName}`);
    }
    const durableJob = await this.jobs.getJob(jobId);
    const redisJob = await this.queues.getJob(queueName as QueueName, jobId);
    return {
      durableJob,
      redisState: redisJob ? await redisJob.getState() : 'missing',
      progress: redisJob?.progress ?? null,
      failedReason: redisJob?.failedReason ?? null,
      data: redisJob?.data ?? null,
      returnValue: redisJob?.returnvalue ?? null,
      stacktrace: redisJob?.stacktrace ?? null,
    };
  }

  @Post(':queueName/jobs/:jobId/retry')
  async retry(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
  ) {
    if (!this.queues.getQueueNames().includes(queueName as QueueName)) {
      throw new BadRequestException(`Unknown queue ${queueName}`);
    }
    await this.queues.retryJob(queueName as QueueName, jobId);
    return { status: 'retried' };
  }

  @Delete(':queueName/jobs/:jobId')
  async remove(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
  ) {
    if (!this.queues.getQueueNames().includes(queueName as QueueName)) {
      throw new BadRequestException(`Unknown queue ${queueName}`);
    }
    await this.queues.removeJob(queueName as QueueName, jobId);
    return { status: 'removed' };
  }
}
