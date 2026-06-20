import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueEvents } from 'bullmq';

import { IConfig, RedisConfig } from '@/config';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { QUEUES } from '@/modules/queue/constants/queues';

@Injectable()
export class QueueEventsMonitorService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly monitors: QueueEvents[] = [];

  constructor(
    private readonly config: ConfigService<IConfig>,
    private readonly logs: OperationalLoggerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const redis = this.config.get<RedisConfig>('redis');
    for (const queueName of Object.values(QUEUES)) {
      const events = new QueueEvents(queueName, {
        connection: {
          host: redis?.host ?? 'localhost',
          port: redis?.port ?? 6379,
          password: redis?.password || undefined,
          db: redis?.db ?? 0,
          maxRetriesPerRequest: null,
        },
      });
      this.monitors.push(events);
      events.on('waiting', ({ jobId }) =>
        this.emit(queueName, jobId, 'queue.job.waiting', 'waiting'),
      );
      events.on('stalled', ({ jobId }) =>
        this.emit(queueName, jobId, 'queue.job.stalled', 'stalled', 'warn'),
      );
      events.on('failed', ({ jobId, failedReason }) =>
        this.emit(queueName, jobId, 'queue.job.failed', failedReason, 'error'),
      );
      await events.waitUntilReady();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.monitors.map((monitor) => monitor.close()));
  }

  private emit(
    queueName: string,
    jobId: string,
    eventType: string,
    status: string,
    level: 'info' | 'warn' | 'error' = 'info',
  ): void {
    void this.logs.emit({
      level,
      message: `${queueName} job ${jobId}: ${status}`,
      context: QueueEventsMonitorService.name,
      eventType,
      queueName,
      jobId,
      status,
    });
  }
}
