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
import { DurableQueueJobStatus } from '@/modules/queue/schemas/queue-job.schema';
import {
  BatchPostingControlService,
  InFlightPosting,
} from '@/modules/queue/services/batch-posting-control.service';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';
import {
  QueueName,
  QueueService,
} from '@/modules/queue/services/queue.service';
import { UserRole } from '@/modules/user/schemas/user.schema';

type QueueCleanScope = 'failed' | 'completed' | 'waiting' | 'active' | 'all';

@ApiBearerAuth()
@ApiTags('Admin Queues')
@Controller('admin/queues')
@Roles(UserRole.ADMIN)
export class AdminQueuesController {
  constructor(
    private readonly queues: QueueService,
    private readonly jobs: QueueJobStoreService,
    private readonly redis: LogStreamService,
    private readonly postingControl: BatchPostingControlService,
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

  /**
   * Postings that have not finished, with the pause state of their batch, so
   * Observability can hold a single batch back without pausing a whole queue.
   */
  @Get('postings')
  listInFlightPostings(): Promise<InFlightPosting[]> {
    return this.postingControl.listInFlight();
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
    const queue = await this.queues.setPaused(this.requireQueue(queueName), true);
    return { status: 'paused', queue };
  }

  @Post(':queueName/resume')
  async resumeQueue(@Param('queueName') queueName: string) {
    const queue = await this.queues.setPaused(
      this.requireQueue(queueName),
      false,
    );
    return { status: 'resumed', queue };
  }

  /**
   * Permanently clear BullMQ job counts for a queue (and matching durable
   * records). scope=failed|completed|waiting|active|all.
   */
  @Post(':queueName/clean')
  async cleanQueue(
    @Param('queueName') queueName: string,
    @Query('scope') scope: QueueCleanScope = 'failed',
  ) {
    const name = this.requireQueue(queueName);
    const normalized = (scope || 'failed').toLowerCase() as QueueCleanScope;
    if (
      !['failed', 'completed', 'waiting', 'active', 'all'].includes(normalized)
    ) {
      throw new BadRequestException(
        `Unknown clean scope ${scope}. Use failed|completed|waiting|active|all`,
      );
    }

    const redisTypes =
      normalized === 'failed'
        ? (['failed'] as const)
        : normalized === 'completed'
          ? (['completed'] as const)
          : normalized === 'waiting'
            ? (['wait', 'delayed', 'paused'] as const)
            : normalized === 'active'
              ? (['active'] as const)
              : ([
                  'failed',
                  'completed',
                  'wait',
                  'delayed',
                  'paused',
                  'active',
                ] as const);

    const durableStatuses =
      normalized === 'failed'
        ? [DurableQueueJobStatus.FAILED]
        : normalized === 'completed'
          ? [DurableQueueJobStatus.COMPLETED]
          : normalized === 'waiting'
            ? [DurableQueueJobStatus.QUEUED, DurableQueueJobStatus.PAUSED]
            : normalized === 'active'
              ? [
                  DurableQueueJobStatus.ACTIVE,
                  DurableQueueJobStatus.RETRYING,
                ]
              : undefined; // all durable rows for this queue

    const redis = await this.queues.cleanJobs(name, [...redisTypes]);
    // Active jobs may be lock-held by a worker; force-remove leftovers.
    if (normalized === 'active' || normalized === 'all') {
      redis.active =
        (redis.active ?? 0) + (await this.queues.forceRemoveActiveJobs(name));
    }
    const durablePurged = await this.jobs.purgeByQueue(name, durableStatuses);

    return {
      status: 'cleaned',
      scope: normalized,
      redis,
      durablePurged,
    };
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
    // Drop Redis work if still present, then always purge the durable record
    // so the Queues tab stops showing finished/stuck jobs after delete.
    const redis = await this.queues.removeJob(queueName as QueueName, jobId);
    await this.jobs.purgeJob(jobId);
    return { status: 'removed', redis, durablePurged: true };
  }

  private requireQueue(queueName: string): QueueName {
    if (!this.queues.getQueueNames().includes(queueName as QueueName)) {
      throw new BadRequestException(`Unknown queue ${queueName}`);
    }
    return queueName as QueueName;
  }
}
