import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import {
  NewOperationalLogEvent,
  OperationalLogLevel,
  OperationalLogPayload,
} from '@/modules/observability/interfaces/operational-log.interface';
import { LogStreamService } from '@/modules/observability/services/log-stream.service';

@Injectable()
export class OperationalLoggerService {
  constructor(
    private readonly stream: LogStreamService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OperationalLoggerService.name);
  }

  async emit(event: NewOperationalLogEvent): Promise<void> {
    this.writeConsole(event.level, event);
    try {
      await this.stream.publish(event);
    } catch (error) {
      this.logger.error(
        { err: error, eventType: event.eventType },
        'Failed to publish operational log',
      );
    }
  }

  private writeConsole(
    level: OperationalLogLevel,
    event: NewOperationalLogEvent,
  ): void {
    // Captured bodies can be megabytes; the console gets a summary while the
    // full body goes to the log store.
    const line = {
      ...event,
      message: undefined,
      payload: event.payload ? this.summarizePayload(event.payload) : undefined,
    };
    if (level === 'error') this.logger.error(line, event.message);
    else if (level === 'warn') this.logger.warn(line, event.message);
    else this.logger.info(line, event.message);
  }

  private summarizePayload(
    payload: OperationalLogPayload,
  ): Record<string, unknown> {
    const summarize = (side: keyof OperationalLogPayload) => {
      const snapshot = payload[side];
      if (!snapshot) return undefined;
      return {
        sizeBytes: snapshot.sizeBytes,
        truncated: snapshot.truncated,
        ...(snapshot.captureError
          ? { captureError: snapshot.captureError }
          : {}),
      };
    };

    return {
      request: summarize('request'),
      response: summarize('response'),
    };
  }
}
