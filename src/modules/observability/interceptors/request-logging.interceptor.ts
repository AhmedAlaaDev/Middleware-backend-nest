import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { LogPayloadService } from '@/modules/observability/services/log-payload.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';

const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logs: OperationalLoggerService,
    private readonly payloads: LogPayloadService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const startedAt = Date.now();
    const request = context.switchToHttp().getRequest<Req>();
    const response = context.switchToHttp().getResponse<Res>();
    // Read before the handler runs: interceptors such as ValidationPipe and
    // file upload handling mutate req.body downstream.
    const requestBody = this.captureRequestBody(request);

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
          ...(requestBody ? { payload: { request: requestBody } } : {}),
        });
      }),
    );
  }

  private captureRequestBody(request: Req) {
    if (BODYLESS_METHODS.has(request.method)) return undefined;

    const contentType = String(request.headers['content-type'] ?? '');
    // Multipart bodies are Excel uploads; the parsed fields are logged, the
    // file bytes are not.
    if (contentType.includes('multipart/form-data')) {
      return this.payloads.capture({
        contentType,
        note: 'multipart/form-data body omitted; see upload metadata',
      });
    }

    return this.payloads.capture(request.body);
  }
}
