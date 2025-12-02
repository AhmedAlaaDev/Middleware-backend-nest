/**
 * TransformResInterceptor (Enterprise Pro – Success Envelope)
 * -----------------------------------------------------------
 * - Wraps successful handler results into a unified ApiResponse<T> envelope.
 * - Mirrors the error envelope's "meta" structure (requestId, timestamp, path, method).
 * - Skips transformation for non-API routes (URL not starting with "/api").
 * - Skips transformation for stream/file responses (best-effort detection).
 * - Handles 204 No Content cleanly.
 *
 * Notes:
 * - Uses global `Req` and `Res` ambient types (as per your setup).
 * - Keeps payload minimal (no `error`, no `validationErrors` on success).
 * - Default user-friendly success messages; customizable later (i18n).
 */

import { randomUUID } from 'crypto';

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// ---------- Shared Types (align with your ApiResponse<T>) ----------
interface ApiSuccessStatus {
  code: number;
  message?: string; // "Success", "Created", etc.
}

interface ApiMeta {
  requestId?: string;
  timestamp?: string; // ISO 8601
  path?: string;
  method?: string;
}

interface ApiResponse<T> {
  status: ApiSuccessStatus;
  meta?: ApiMeta;
  data: T | null;
}

// ---------- Interceptor ----------
@Injectable()
export class GlobalResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  /**
   * Intercepts outgoing successful responses and wraps them in a standard envelope.
   */
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    const http = context.switchToHttp();
    const req = http.getRequest<Req>();
    const res = http.getResponse<Res>();

    const url = req.originalUrl || req.url;

    // Ignore non-API routes
    if (!url.startsWith('/api')) {
      return next.handle() as unknown as Observable<ApiResponse<T>>;
    }

    // For file/stream responses, skip wrapping (best-effort detection)
    if (this.isStreamOrFileResponse(res)) {
      return next.handle() as unknown as Observable<ApiResponse<T>>;
    }

    return next.handle().pipe(
      map((data: T): ApiResponse<T> => {
        const statusCode = res.statusCode ?? HttpStatus.OK;

        // Handle 204 No Content → return envelope with null data
        if (
          this.toHttpStatus(statusCode) === HttpStatus.NO_CONTENT ||
          typeof data === 'undefined'
        ) {
          return this.buildApiSuccessResponse(
            null as unknown as T,
            {
              code: statusCode,
              message: this.successMessageFor(statusCode),
            },
            this.buildMeta(req),
          );
        }

        // Normal success
        return this.buildApiSuccessResponse(
          data,
          {
            code: statusCode,
            message: this.successMessageFor(statusCode),
          },
          this.buildMeta(req),
        );
      }),
    );
  }

  // ---------- Private: Builders ----------

  /**
   * Builds the final ApiResponse<T> envelope for success responses.
   * - Compacts away null/undefined keys.
   */
  private buildApiSuccessResponse(
    data: T,
    status: ApiSuccessStatus,
    meta: ApiMeta,
  ): ApiResponse<T> {
    return this.compact<ApiResponse<T>>({
      status: this.compact(status),
      meta: this.compact(meta),
      data,
    });
  }

  /**
   * Builds meta to mirror error filter meta for observability and support.
   * - Preserves inbound `x-request-id` when present; otherwise generates a UUID.
   */
  private buildMeta(req: Req): ApiMeta {
    return this.compact<ApiMeta>({
      requestId: (req.headers['x-request-id'] as string) || randomUUID(),
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.url,
      method: req.method,
    });
  }

  /**
   * Returns a friendly success message based on status code.
   * Typed to HttpStatus to keep ESLint happy if you enable the rule for enums.
   */
  private successMessageFor(code: number): string {
    const status = this.toHttpStatus(code);
    switch (status) {
      case HttpStatus.OK:
        return 'Success';
      case HttpStatus.CREATED:
        return 'Created successfully';
      case HttpStatus.ACCEPTED:
        return 'Accepted';
      case HttpStatus.NO_CONTENT:
        return 'No content';
      default:
        return 'Success';
    }
  }

  /**
   * Best-effort detection for stream/file responses to avoid double-sending/wrapping.
   * - If headers imply attachment or non-JSON content, skip wrapping.
   */
  private isStreamOrFileResponse(res: Res): boolean {
    const cd = res.getHeader?.('content-disposition');
    if (typeof cd === 'string' && /attachment/i.test(cd)) return true;

    const ct = res.getHeader?.('content-type');
    if (typeof ct === 'string' && !/application\/json|\/json/i.test(ct))
      return true;

    return false;
  }

  // ---------- Private: Utilities ----------

  /**
   * Converts a numeric status to HttpStatus enum (shared enum type).
   * Satisfies @typescript-eslint/no-unsafe-enum-comparison when used in switch/case.
   */
  private toHttpStatus(code: number): HttpStatus {
    return HttpStatus[code] !== undefined
      ? (code as HttpStatus)
      : HttpStatus.OK;
  }

  /**
   * Removes undefined/null keys for a cleaner payload.
   */
  private compact<T extends Record<string, any>>(obj: T): T {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined && v !== null)
        out[k] = v as T[Extract<keyof T, string>];
    }
    return out as T;
  }
}
