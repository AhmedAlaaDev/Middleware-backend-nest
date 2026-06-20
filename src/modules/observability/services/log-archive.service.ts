import { hostname } from 'os';

import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';

import { IConfig, ObservabilityConfig } from '@/config';
import { OperationalLogEvent } from '@/modules/observability/interfaces/operational-log.interface';
import { ApplicationLog } from '@/modules/observability/schemas/application-log.schema';
import { LogStreamService } from '@/modules/observability/services/log-stream.service';

type StreamEntry = [id: string, fields: string[]];

@Injectable()
export class LogArchiveService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly consumer = `${hostname()}-${process.pid}`;
  private readonly redis: Redis;
  private readonly config: ObservabilityConfig;
  private running = true;
  private lastReclaimAt = 0;

  constructor(
    @InjectModel(ApplicationLog.name, 'logs')
    private readonly model: Model<ApplicationLog>,
    stream: LogStreamService,
    configService: ConfigService<IConfig>,
    private readonly logger: PinoLogger,
  ) {
    this.redis = stream.getClient().duplicate();
    this.config =
      configService.getOrThrow<ObservabilityConfig>('observability');
    this.logger.setContext(LogArchiveService.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureConsumerGroup();
    void this.consume();
  }

  onApplicationShutdown(): void {
    this.running = false;
    this.redis.disconnect();
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.redis.xgroup(
        'CREATE',
        this.config.streamKey,
        this.config.consumerGroup,
        '0',
        'MKSTREAM',
      );
    } catch (error) {
      if (!String(error).includes('BUSYGROUP')) throw error;
    }
  }

  private async consume(): Promise<void> {
    while (this.running) {
      try {
        await this.reclaimAbandoned();
        const result = (await this.redis.xreadgroup(
          'GROUP',
          this.config.consumerGroup,
          this.consumer,
          'COUNT',
          500,
          'BLOCK',
          1000,
          'STREAMS',
          this.config.streamKey,
          '>',
        )) as Array<[string, StreamEntry[]]> | null;

        const entries = result?.[0]?.[1] ?? [];
        if (entries.length) await this.archive(entries);
      } catch (error) {
        if (!this.running) return;
        this.logger.error({ err: error }, 'Log archive consumer failed');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async reclaimAbandoned(): Promise<void> {
    const now = Date.now();
    if (now - this.lastReclaimAt < 60_000) return;
    this.lastReclaimAt = now;

    const result = (await this.redis.xautoclaim(
      this.config.streamKey,
      this.config.consumerGroup,
      this.consumer,
      60_000,
      '0-0',
      'COUNT',
      500,
    )) as [string, StreamEntry[]];
    if (result[1]?.length) await this.archive(result[1]);
  }

  private async archive(entries: StreamEntry[]): Promise<void> {
    const parsed = entries
      .map(([id, fields]) => ({ id, event: this.parseEvent(fields) }))
      .filter(
        (
          value,
        ): value is {
          id: string;
          event: OperationalLogEvent;
        } => Boolean(value.event),
      );

    if (!parsed.length) {
      await this.ack(entries.map(([id]) => id));
      return;
    }

    try {
      await this.model.bulkWrite(
        parsed.map(({ event }) => ({
          updateOne: {
            filter: { eventId: event.eventId },
            update: {
              $setOnInsert: {
                ...event,
                timestamp: new Date(event.timestamp),
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      await this.ack(parsed.map(({ id }) => id));
      await this.redis.hdel(
        `${this.config.streamKey}:failures`,
        ...parsed.map(({ id }) => id),
      );
    } catch (error) {
      await this.handleArchiveFailure(parsed, error);
    }
  }

  private parseEvent(fields: string[]): OperationalLogEvent | null {
    const eventIndex = fields.indexOf('event');
    if (eventIndex < 0 || !fields[eventIndex + 1]) return null;
    try {
      return JSON.parse(fields[eventIndex + 1]) as OperationalLogEvent;
    } catch {
      return null;
    }
  }

  private async handleArchiveFailure(
    entries: Array<{ id: string; event: OperationalLogEvent }>,
    error: unknown,
  ): Promise<void> {
    for (const { id, event } of entries) {
      const failures = await this.redis.hincrby(
        `${this.config.streamKey}:failures`,
        id,
        1,
      );
      if (failures < 5) continue;

      await this.redis.xadd(
        this.config.deadLetterStreamKey,
        '*',
        'event',
        JSON.stringify(event),
        'archiveError',
        error instanceof Error ? error.message : String(error),
      );
      await this.ack([id]);
    }
    throw error;
  }

  private async ack(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.redis.xack(
      this.config.streamKey,
      this.config.consumerGroup,
      ...ids,
    );
  }
}
