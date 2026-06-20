import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import {
  NewOperationalLogEvent,
  OperationalLogLevel,
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
    const payload = { ...event, message: undefined };
    if (level === 'error') this.logger.error(payload, event.message);
    else if (level === 'warn') this.logger.warn(payload, event.message);
    else this.logger.info(payload, event.message);
  }
}
