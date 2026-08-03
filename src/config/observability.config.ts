import { registerAs } from '@nestjs/config';

export interface ObservabilityConfig {
  logMongoUri: string;
  retentionDays: number;
  streamKey: string;
  deadLetterStreamKey: string;
  streamMaxLength: number;
  consumerGroup: string;
  capturePayloads: boolean;
  payloadMaxBytes: number;
  payloadMaxStringLength: number;
  payloadMaxDepth: number;
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
    capturePayloads: process.env.LOG_CAPTURE_PAYLOADS !== 'false',
    payloadMaxBytes: Number.parseInt(
      process.env.LOG_PAYLOAD_MAX_BYTES ?? '1048576',
      10,
    ),
    payloadMaxStringLength: Number.parseInt(
      process.env.LOG_PAYLOAD_MAX_STRING_LENGTH ?? '32768',
      10,
    ),
    payloadMaxDepth: Number.parseInt(
      process.env.LOG_PAYLOAD_MAX_DEPTH ?? '12',
      10,
    ),
  }),
);
