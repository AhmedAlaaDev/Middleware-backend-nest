/**
 * GlobalExceptionFilter (Enterprise Pro)
 * --------------------------------------
 * - Unifies error responses in a clean, frontend-friendly envelope.
 * - Separates user-facing and developer-facing messages.
 * - Adds meta (requestId, timestamp, path, method) and (dev-only) stack.
 * - Handles HttpException, class-validator errors, and unknown/runtime errors.
 * - SOLID/DRY: small private helpers, clear normalization pipeline.
 *
 * ESLint compliance:
 * - Fixes @typescript-eslint/no-unsafe-enum-comparison by ensuring all switch/case
 *   branches operate on a shared enum type (HttpStatus), not on plain numbers.
 */

import { randomUUID } from 'crypto';

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

// NOTE: `Req` and `Res` are assumed to be declared globally (ambient types).
// Example (ambient):
//   declare type Req = import('express').Request
//   declare type Res = import('express').Response

type ValidationErrors = Record<string, string[]>;

interface ApiErrorStatus {
  code: number;
  userMessage?: string;
  developerMessage?: string;
  errorCode?: string; // e.g. "VAL_001", "AUTH_401", ...
  validationErrors?: ValidationErrors;
}

interface ApiMeta {
  requestId?: string;
  timestamp?: string; // ISO 8601
  path?: string;
  method?: string;
  /** Included only in non-production environments */
  stack?: string;
}

interface ApiResponse<T> {
  status: ApiErrorStatus;
  meta?: ApiMeta;
  data: T | null;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  /**
   * Entry point invoked by Nest when an exception bubbles up the HTTP pipeline.
   * Delegates to normalization helpers and outputs a unified ApiResponse.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const { req, res } = this.getHttpContext(host);

    const normalized = this.normalizeException(exception);
    const meta = this.buildMeta(req, normalized.stack);

    const payload = this.buildApiErrorResponse({
      status: normalized.status,
      userMessage: normalized.userMessage,
      developerMessage: normalized.developerMessage,
      errorCode: normalized.errorCode,
      validationErrors: normalized.validationErrors,
      meta,
    });

    // Minimal inline log (replace with proper logger later if you wish)
    // eslint-disable-next-line no-console
    console.log(
      `[${req.method}] ${req.originalUrl || req.url} -> ${
        normalized.status
      } :: ${normalized.developerMessage ?? normalized.userMessage}`,
    );

    res.status(normalized.status).json(payload);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // HTTP context & minimal logging
  // ────────────────────────────────────────────────────────────────────────────────

  /**
   * Extracts Req and Res from the current HTTP adapter context.
   */
  private getHttpContext(host: ArgumentsHost): { req: Req; res: Res } {
    const ctx = host.switchToHttp();
    return {
      req: ctx.getRequest<Req>(),
      res: ctx.getResponse<Res>(),
    };
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // Normalization pipeline
  // ────────────────────────────────────────────────────────────────────────────────

  /**
   * Normalizes any thrown value into a structured shape
   * consumable by the response builder.
   */
  private normalizeException(exception: unknown): {
    status: number;
    userMessage: string;
    developerMessage?: string;
    errorCode?: string;
    validationErrors?: ValidationErrors;
    stack?: string;
  } {
    if (exception instanceof HttpException) {
      return this.normalizeHttpException(exception);
    }

    if (exception instanceof Error) {
      // Unhandled runtime error (e.g., DB/connectivity/runtime bugs)
      const status = HttpStatus.INTERNAL_SERVER_ERROR;
      return {
        status,
        userMessage: this.defaultUserMessage(this.toHttpStatus(status)),
        developerMessage: exception.message || 'Internal Server Error',
        errorCode: this.defaultErrorCode(this.toHttpStatus(status)),
        stack: exception.stack,
      };
    }

    // Completely unknown shape
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    return {
      status,
      userMessage: this.defaultUserMessage(this.toHttpStatus(status)),
      developerMessage: 'Internal Server Error',
      errorCode: this.defaultErrorCode(this.toHttpStatus(status)),
    };
  }

  /**
   * Special handling for HttpException (standard NestJS errors and ValidationPipe).
   */
  private normalizeHttpException(exception: HttpException) {
    const rawStatus =
      exception.getStatus?.() ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const statusEnum = this.toHttpStatus(rawStatus);
    const raw = exception.getResponse?.();

    // Defaults
    let userMessage = this.defaultUserMessage(statusEnum);
    let developerMessage: string | undefined;
    let errorCode = this.defaultErrorCode(statusEnum);
    let validationErrors: ValidationErrors | undefined;

    if (typeof raw === 'string') {
      developerMessage = raw;
      return { status: rawStatus, userMessage, developerMessage, errorCode };
    }

    // Check for custom validation error structure (from post-ar-batch-to-dfo handler)
    if (this.isCustomValidationErrorObject(raw)) {
      developerMessage = raw.message || 'Validation failed';
      userMessage = 'Some fields are invalid. Please review and try again.';
      errorCode = 'VAL_001';
      validationErrors = this.coerceCustomValidationErrors(raw.errors);
      return {
        status: rawStatus,
        userMessage,
        developerMessage,
        errorCode,
        validationErrors,
      };
    }

    // Typical ValidationPipe response or custom objects
    if (this.isBasicErrorObject(raw)) {
      const msg = raw.message;
      const err = raw.error;

      if (Array.isArray(msg)) {
        // class-validator array of messages
        developerMessage = 'Validation failed';
        userMessage = 'Some fields are invalid. Please review and try again.';
        errorCode = 'VAL_001';
        validationErrors = this.coerceArrayToValidationMap(msg);
      } else if (typeof msg === 'string' && msg.trim()) {
        developerMessage = msg;
      } else if (typeof err === 'string' && err.trim()) {
        developerMessage = err;
      } else {
        developerMessage = this.defaultDeveloperMessage(statusEnum);
      }

      return {
        status: rawStatus,
        userMessage,
        developerMessage,
        errorCode,
        validationErrors,
      };
    }

    // Some pipes may pass arrays of ValidationError objects
    if (this.isValidationErrorArray(raw)) {
      developerMessage = 'Validation failed';
      userMessage = 'Some fields are invalid. Please review and try again.';
      errorCode = 'VAL_001';
      validationErrors = this.coerceValidationErrorArray(raw);
      return {
        status: rawStatus,
        userMessage,
        developerMessage,
        errorCode,
        validationErrors,
      };
    }

    // Unknown object shape
    developerMessage =
      typeof raw === 'object' &&
      raw !== null &&
      'message' in raw &&
      typeof (raw as { message?: unknown }).message === 'string'
        ? (raw as { message: string }).message
        : this.defaultDeveloperMessage(statusEnum);
    return { status: rawStatus, userMessage, developerMessage, errorCode };
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // Response & meta builders
  // ────────────────────────────────────────────────────────────────────────────────

  /**
   * Builds the final ApiResponse<null> envelope, compacting away empty fields.
   */
  private buildApiErrorResponse(input: {
    status: number;
    userMessage: string;
    developerMessage?: string;
    errorCode?: string;
    validationErrors?: ValidationErrors;
    meta?: ApiMeta;
  }): ApiResponse<null> {
    const statusObj: ApiErrorStatus = this.compact({
      code: input.status,
      userMessage: input.userMessage,
      developerMessage: input.developerMessage,
      errorCode: input.errorCode,
      validationErrors:
        input.validationErrors && Object.keys(input.validationErrors).length
          ? input.validationErrors
          : undefined,
    });

    const meta = input.meta && this.compact(input.meta);

    return this.compact<ApiResponse<null>>({
      status: statusObj,
      meta,
      data: null,
    });
  }

  /**
   * Builds meta data (requestId, timestamp, path, method, and dev-only stack).
   * - If a gateway already supplies `x-request-id`, it is preserved.
   * - Otherwise, a new UUID is generated.
   */
  private buildMeta(req: Req, stack?: string): ApiMeta {
    const isProd = process.env.NODE_ENV === 'production';

    const meta: ApiMeta = {
      requestId: (req.headers['x-request-id'] as string) || randomUUID(),
      timestamp: new Date().toISOString(),
      path: (req as { originalUrl?: string }).originalUrl || req.url,
      method: req.method,
      stack: !isProd ? stack : undefined,
    };

    return this.compact(meta);
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // Type guards
  // ────────────────────────────────────────────────────────────────────────────────

  /**
   * Guards for custom validation error structure from post-ar-batch-to-dfo handler
   */
  private isCustomValidationErrorObject(raw: unknown): raw is {
    message?: string;
    errors: Array<{
      invoiceIndex?: number;
      lineNumber?: number;
      missingFields: string[];
    }>;
    details?: string;
  } {
    return (
      !!raw &&
      typeof raw === 'object' &&
      'errors' in (raw as any) &&
      Array.isArray((raw as any).errors) &&
      (raw as any).errors.length > 0 &&
      typeof (raw as any).errors[0] === 'object' &&
      'missingFields' in (raw as any).errors[0]
    );
  }

  /**
   * Guards a typical shape returned by ValidationPipe or custom HttpExceptions.
   */
  private isBasicErrorObject(raw: unknown): raw is {
    message?: string | string[];
    error?: string;
    statusCode?: number;
  } {
    return (
      !!raw &&
      typeof raw === 'object' &&
      ('message' in (raw as any) || 'error' in (raw as any)) &&
      !this.isCustomValidationErrorObject(raw)
    );
  }

  /**
   * Guards an array of class-validator ValidationError objects.
   */
  private isValidationErrorArray(raw: unknown): raw is Array<{
    property: string;
    constraints?: Record<string, string>;
    children?: any[];
  }> {
    return (
      Array.isArray(raw) &&
      raw.length > 0 &&
      typeof raw[0] === 'object' &&
      raw[0] !== null &&
      'property' in raw[0]
    );
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // Validation mapping (DRY)
  // ────────────────────────────────────────────────────────────────────────────────

  /**
   * Converts an array of free-text messages into a field-indexed map:
   *   "email must be an email" → { email: ["must be an email"] }
   * Heuristic: first token is the field name; the remainder is the message.
   */
  private coerceArrayToValidationMap(messages: string[]): ValidationErrors {
    return messages.reduce<ValidationErrors>((acc, line) => {
      const [first, ...rest] = (line || '').split(' ');
      const key = first?.trim() || 'root';
      const msg = rest.join(' ').trim() || line.trim() || 'Invalid value';
      (acc[key] ||= []).push(msg);
      return acc;
    }, {});
  }

  /**
   * Converts custom validation errors from post-ar-batch-to-dfo handler to ValidationErrors format
   */
  private coerceCustomValidationErrors(
    errors: Array<{
      invoiceIndex?: number;
      lineNumber?: number;
      missingFields: string[];
    }>,
  ): ValidationErrors {
    const map: ValidationErrors = {};

    errors.forEach((error) => {
      if (error.lineNumber !== undefined) {
        // Line validation error
        const key = `Invoice[${error.invoiceIndex ?? '?'}].Line[${error.lineNumber}]`;
        map[key] = error.missingFields.map(
          (field) => `Missing required field: ${field}`,
        );
      } else {
        // Header validation error
        const key = `Invoice[${error.invoiceIndex ?? '?'}].Header`;
        map[key] = error.missingFields.map(
          (field) => `Missing required field: ${field}`,
        );
      }
    });

    return map;
  }

  /**
   * Flattens class-validator ValidationError[] into a map of dot-notated fields.
   */
  private coerceValidationErrorArray(
    errors: Array<{
      property: string;
      constraints?: Record<string, string>;
      children?: any[];
    }>,
  ): ValidationErrors {
    const map: ValidationErrors = {};
    const walk = (items: typeof errors, parent?: string) => {
      for (const e of items) {
        const field = parent ? `${parent}.${e.property}` : e.property;
        if (e.constraints && Object.keys(e.constraints).length) {
          map[field] = Object.values(e.constraints);
        }
        if (Array.isArray(e.children) && e.children.length) {
          walk(
            e.children as Array<{
              property: string;
              constraints?: Record<string, string>;
              children?: any[];
            }>,
            field,
          );
        }
      }
    };
    walk(errors);
    return map;
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // Defaults & helpers (typed with HttpStatus to satisfy eslint rule)
  // ────────────────────────────────────────────────────────────────────────────────

  /**
   * Safely converts a numeric status code into a HttpStatus enum value.
   * This ensures switch/case operate on a *shared enum type*, satisfying:
   *   @typescript-eslint/no-unsafe-enum-comparison
   */
  private toHttpStatus(code: number): HttpStatus {
    // HttpStatus is a numeric enum with reverse mapping: HttpStatus[code] => name | undefined
    return HttpStatus[code] !== undefined
      ? (code as HttpStatus)
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  /**
   * User-facing friendly message map based on HttpStatus.
   * (No technical details are leaked to the end-user.)
   */
  private defaultUserMessage(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'Some fields are invalid. Please review and try again.';
      case HttpStatus.UNAUTHORIZED:
        return 'Authentication is required to access this resource.';
      case HttpStatus.FORBIDDEN:
        return 'You do not have permission to perform this action.';
      case HttpStatus.NOT_FOUND:
        return 'The requested resource was not found.';
      case HttpStatus.CONFLICT:
        return 'A conflict occurred while processing your request.';
      default:
        return 'Something went wrong. Please try again later.';
    }
  }

  /**
   * Developer-facing default message map based on HttpStatus.
   */
  private defaultDeveloperMessage(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'Bad Request';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'Validation failed';
      case HttpStatus.UNAUTHORIZED:
        return 'Unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'Forbidden';
      case HttpStatus.NOT_FOUND:
        return 'Not Found';
      case HttpStatus.CONFLICT:
        return 'Conflict';
      default:
        return 'Internal Server Error';
    }
  }

  /**
   * Internal error code taxonomy mapping based on HttpStatus.
   */
  private defaultErrorCode(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'REQ_400';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'VAL_001';
      case HttpStatus.UNAUTHORIZED:
        return 'AUTH_401';
      case HttpStatus.FORBIDDEN:
        return 'AUTH_403';
      case HttpStatus.NOT_FOUND:
        return 'RES_404';
      case HttpStatus.CONFLICT:
        return 'RES_409';
      default:
        return 'SRV_500';
    }
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
