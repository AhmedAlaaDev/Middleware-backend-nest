import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logs: OperationalLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const startedAt = Date.now();
    const request = context.switchToHttp().getRequest<Req>();
    const response = context.switchToHttp().getResponse<Res>();

    return next.handle().pipe(
      finalize(() => {
        void this.logs.emit({
          level: response.statusCode >= 500 ? 'error' : 'info',
          message: `${request.method} ${request.originalUrl || request.url}`,
          context: 'HttpRequest',
          eventType: 'http.request.completed',
          requestId: request.headers['x-request-id'] as string,
          correlationId: request.headers['x-correlation-id'] as string,
          userId: request.user?.id,
          status: String(response.statusCode),
          durationMs: Date.now() - startedAt,
          metadata: {
            method: request.method,
            path: request.originalUrl || request.url,
          },
        });
      }),
    );
  }
}
