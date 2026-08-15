import { randomUUID } from 'crypto';
import { hostname } from 'os';

import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { IConfig, ObservabilityConfig, RedisConfig } from '@/config';
import {
  NewOperationalLogEvent,
  OperationalLogEvent,
} from '@/modules/observability/interfaces/operational-log.interface';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';

@Injectable()
export class LogStreamService implements OnApplicationShutdown {
  private readonly redis: Redis;
  private readonly config: ObservabilityConfig;

  constructor(
    configService: ConfigService<IConfig>,
    private readonly traceContext: TraceContextService,
  ) {
    const redis = configService.get<RedisConfig>('redis');
    this.config =
      configService.getOrThrow<ObservabilityConfig>('observability');
    this.redis = new Redis({
      host: redis?.host ?? 'localhost',
      port: redis?.port ?? 6379,
      password: redis?.password || undefined,
      db: redis?.db ?? 0,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    });
  }

  async publish(input: NewOperationalLogEvent): Promise<OperationalLogEvent> {
    if (this.redis.status === 'end' || this.redis.status === 'close') {
      try {
        await this.redis.connect();
      } catch {
        // Silent catch; xadd below will either succeed or be caught by OperationalLoggerService
      }
    }

    const trace = this.traceContext.get();
    const event: OperationalLogEvent = {
      ...input,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      correlationId: input.correlationId ?? trace?.correlationId,
      requestId: input.requestId ?? trace?.requestId,
      userId: input.userId ?? trace?.userId,
      batchId: input.batchId ?? trace?.batchId,
      jobId: input.jobId ?? trace?.jobId,
      queueName: input.queueName ?? trace?.queueName,
      metadata: {
        host: hostname(),
        ...(input.metadata ?? {}),
      },
    };

    await this.redis.xadd(
      this.config.streamKey,
      'MAXLEN',
      '~',
      this.config.streamMaxLength,
      '*',
      'event',
      JSON.stringify(event),
    );
    return event;
  }

  async ping(): Promise<'PONG'> {
    return this.redis.ping();
  }

  async getMetrics() {
    const [memory, persistence, streamLength, pending] = await Promise.all([
      this.redis.info('memory'),
      this.redis.info('persistence'),
      this.redis.xlen(this.config.streamKey),
      this.redis
        .xpending(this.config.streamKey, this.config.consumerGroup)
        .catch(() => [0]),
    ]);
    return {
      streamLength,
      pending: Number(pending[0] ?? 0),
      memory: this.parseInfo(memory),
      persistence: this.parseInfo(persistence),
    };
  }

  getClient(): Redis {
    return this.redis;
  }

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }

  private parseInfo(info: string): Record<string, string> {
    return Object.fromEntries(
      info
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => line.trim().split(':', 2))
        .filter((parts) => parts.length === 2),
    );
  }
}
