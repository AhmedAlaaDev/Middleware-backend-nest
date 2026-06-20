import { registerAs } from '@nestjs/config';

export interface ObservabilityConfig {
  logMongoUri: string;
  retentionDays: number;
  streamKey: string;
  deadLetterStreamKey: string;
  streamMaxLength: number;
  consumerGroup: string;
}

export const observabilityConfig = registerAs(
  'observability',
  (): ObservabilityConfig => ({
    logMongoUri: process.env.LOG_MONGODB_URI ?? process.env.MONGODB_URI ?? '',
    retentionDays: Number.parseInt(process.env.LOG_RETENTION_DAYS ?? '90', 10),
    streamKey: process.env.LOG_REDIS_STREAM ?? 'app:logs:v1',
    deadLetterStreamKey:
      process.env.LOG_REDIS_DEAD_LETTER_STREAM ?? 'app:logs:dead-letter:v1',
    streamMaxLength: Number.parseInt(
      process.env.LOG_REDIS_STREAM_MAX_LENGTH ?? '200000',
      10,
    ),
    consumerGroup: process.env.LOG_REDIS_CONSUMER_GROUP ?? 'mongo-log-writers',
  }),
);
