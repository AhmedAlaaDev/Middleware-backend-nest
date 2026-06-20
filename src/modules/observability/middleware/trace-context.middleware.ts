import { randomUUID } from 'crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

import { TraceContextService } from '@/modules/observability/services/trace-context.service';

@Injectable()
export class TraceContextMiddleware implements NestMiddleware {
  constructor(private readonly traceContext: TraceContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId =
      this.firstHeader(req.headers['x-request-id']) ?? randomUUID();
    const correlationId =
      this.firstHeader(req.headers['x-correlation-id']) ?? requestId;

    req.headers['x-request-id'] = requestId;
    req.headers['x-correlation-id'] = correlationId;
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('X-Correlation-ID', correlationId);

    this.traceContext.run({ requestId, correlationId }, next);
  }

  private firstHeader(
    value: string | string[] | undefined,
  ): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }
}
