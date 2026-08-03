export type OperationalLogLevel = 'info' | 'warn' | 'error';

export type JsonSafeValue =
  | string
  | number
  | boolean
  | null
  | JsonSafeValue[]
  | { [key: string]: JsonSafeValue };

/**
 * A single captured HTTP body (request or response) after redaction.
 *
 * `sizeBytes` is measured on the redacted body before truncation, so a log
 * reader can tell how much of the original payload `body` represents.
 */
export interface OperationalLogBodySnapshot {
  body: JsonSafeValue;
  sizeBytes: number;
  truncated: boolean;
  redactedKeys?: string[];
  /** Set when the body could not be serialized at all. */
  captureError?: string;
}

export interface OperationalLogPayload {
  request?: OperationalLogBodySnapshot;
  response?: OperationalLogBodySnapshot;
}

export interface OperationalLogEvent {
  eventId: string;
  timestamp: string;
  level: OperationalLogLevel;
  message: string;
  context: string;
  eventType: string;
  correlationId?: string;
  requestId?: string;
  userId?: string;
  batchId?: string;
  jobId?: string;
  queueName?: string;
  status?: string;
  durationMs?: number;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, JsonSafeValue | undefined>;
  payload?: OperationalLogPayload;
}

export type NewOperationalLogEvent = Omit<
  OperationalLogEvent,
  'eventId' | 'timestamp'
>;
