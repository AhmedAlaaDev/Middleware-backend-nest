export type OperationalLogLevel = 'info' | 'warn' | 'error';

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
  metadata?: Record<string, string | number | boolean | null>;
}

export type NewOperationalLogEvent = Omit<
  OperationalLogEvent,
  'eventId' | 'timestamp'
>;
