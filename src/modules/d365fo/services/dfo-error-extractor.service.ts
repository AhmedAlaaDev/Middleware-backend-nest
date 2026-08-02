import { Injectable } from '@nestjs/common';

import { DfoApiError } from '@/modules/d365fo/errors/dfo-api.error';

/**
 * Internal normalized shape for errors at the D365FO integration boundary.
 */
export type DfoErrorShape = {
  message: string;
  status?: number;
  code?: string;
  isConcurrencyConflict?: boolean;
  isDependentLinesError?: boolean;
  isResourceNotFound?: boolean;
  isValidationError?: boolean;
};

const CONCURRENCY_KEYWORDS = [
  'update conflict',
  'cannot edit a record',
  'ledgerjournaltable',
  'dependent journal lines exist',
];

const DEPENDENT_LINES_KEYWORDS = [
  'dependent journal lines exist',
  'ledger journal table cannot be deleted',
];

const RESOURCE_NOT_FOUND_KEYWORDS = [
  'no resources were found when selecting for update',
  'no resource was found when selecting for update',
];

@Injectable()
export class DfoErrorExtractorService {
  private collectResponseMessages(value: unknown, depth: number = 0): string[] {
    if (depth > 5 || value === null || value === undefined) return [];

    if (typeof value === 'string') {
      const message = value.trim();
      if (!message) return [];

      if (
        (message.startsWith('{') && message.endsWith('}')) ||
        (message.startsWith('[') && message.endsWith(']'))
      ) {
        try {
          return this.collectResponseMessages(JSON.parse(message), depth + 1);
        } catch {
          // The response is plain text that only resembles JSON.
        }
      }

      return [message];
    }

    if (Array.isArray(value)) {
      return value.flatMap((item) =>
        this.collectResponseMessages(item, depth + 1),
      );
    }

    if (typeof value !== 'object') return [];

    const record = value as Record<string, unknown>;
    const messageKeys = [
      'ExceptionMessage',
      'exceptionMessage',
      'ErrorMessage',
      'errorMessage',
      'Details',
      'details',
      'Message',
      'message',
      'error_description',
      'value',
    ];
    const nestedKeys = [
      'Error',
      'error',
      'InnerException',
      'innerException',
      'innererror',
      'innerError',
      'internalexception',
      'internalException',
    ];

    return [...messageKeys, ...nestedKeys].flatMap((key) =>
      this.collectResponseMessages(record[key], depth + 1),
    );
  }

  private isGenericMessage(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return (
      normalized.startsWith('request failed with status code') ||
      normalized === 'an unexpected x++ error occurred.' ||
      normalized === 'an unexpected x++ error occurred' ||
      normalized === 'an error has occurred.' ||
      normalized === 'an error has occurred' ||
      normalized ===
        'exception has been thrown by the target of an invocation.' ||
      normalized ===
        'exception has been thrown by the target of an invocation' ||
      normalized === 'internal server error'
    );
  }

  private getResponseMessage(value: unknown): string {
    const messages = this.collectResponseMessages(value);
    const detailedMessage = [...messages]
      .reverse()
      .find((message) => !this.isGenericMessage(message));
    return detailedMessage ?? messages[0] ?? '';
  }

  /**
   * Extracts message from internalexception (or internalException) in the D365FO/OData error tree.
   * Walks innererror chain to find the first non-empty internalexception message.
   */
  private getInternalExceptionMessage(node: unknown): string {
    if (!node || typeof node !== 'object') return '';
    const obj = node as Record<string, unknown>;
    const internal = obj.internalexception ?? obj.internalException;
    if (internal) {
      const msg =
        typeof internal === 'object' &&
        internal !== null &&
        'message' in internal
          ? (internal as { message?: string }).message
          : typeof internal === 'string'
            ? internal
            : '';
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
    }
    const inner = obj.innererror;
    if (inner && typeof inner === 'object') {
      const nested = this.getInternalExceptionMessage(inner);
      if (nested) return nested;
    }
    return '';
  }

  /**
   * Normalizes any thrown value from D365FO (Axios-style or OData) into a stable shape.
   * D365FO services use this instead of parsing error.response.data ad hoc.
   */
  normalize(error: unknown): DfoErrorShape {
    if (error instanceof DfoApiError) {
      const responseMessage = this.getResponseMessage(error.response?.data);
      return {
        message: responseMessage || error.message,
        status: error.status,
        code: error.code,
        isConcurrencyConflict: error.isConcurrencyConflict,
        isDependentLinesError: error.isDependentLinesError,
        isResourceNotFound: error.isResourceNotFound,
        isValidationError: error.isValidationError,
      };
    }

    const status =
      typeof (error as any)?.response?.status === 'number'
        ? (error as any).response.status
        : undefined;

    let message = '';
    let code: string | undefined;
    const responseData = (error as any)?.response?.data;

    const d365foError = responseData?.error;
    if (d365foError) {
      if (typeof d365foError === 'object') {
        const innerMessage = d365foError.innererror?.message;
        const genericMessage = d365foError.message;
        code = d365foError.code;
        const resolved =
          innerMessage ?? genericMessage ?? d365foError.code ?? '';
        message = code ? `[${code}] ${resolved}` : resolved;
        if (!message) {
          try {
            message = JSON.stringify(d365foError);
          } catch {
            message = String(d365foError);
          }
        }
        // Append internalexception message when present (D365FO often puts the real cause there)
        const internalMsg = this.getInternalExceptionMessage(d365foError);
        if (internalMsg && !message.includes(internalMsg)) {
          message = message.trimEnd() + (message ? ' | ' : '') + internalMsg;
        }
      } else if (typeof d365foError === 'string') {
        message = d365foError;
      }
    }

    const responseMessage = this.getResponseMessage(responseData);
    if (responseMessage && (!message || this.isGenericMessage(message))) {
      message = responseMessage;
    }

    if (!message && responseData?.error_description) {
      message = responseData.error_description;
    }
    if (!message && responseData?.message) {
      message = responseData.message;
    }
    if (!message && error instanceof Error) {
      message = error.message;
    }
    if (!message && (error as any)?.response?.statusText) {
      message = `HTTP ${(error as any).response.status}: ${(error as any).response.statusText}`;
    }
    if (!message) {
      message = String(error);
    }

    const combinedLower = message.toLowerCase();
    const innerLower =
      (
        (error as any)?.response?.data?.error?.innererror?.message as string
      )?.toLowerCase() ?? '';
    const fullText = `${combinedLower} ${innerLower}`;

    const isConcurrencyConflict =
      status === 400 && CONCURRENCY_KEYWORDS.some((k) => fullText.includes(k));

    const isDependentLinesError = DEPENDENT_LINES_KEYWORDS.some((k) =>
      fullText.includes(k),
    );

    const isResourceNotFound =
      status === 404 ||
      RESOURCE_NOT_FOUND_KEYWORDS.some((k) => fullText.includes(k));

    const isValidationError =
      status === 400 &&
      (fullText.includes('validation') || fullText.includes('invalid'));

    return {
      message,
      status,
      code,
      isConcurrencyConflict,
      isDependentLinesError,
      isResourceNotFound,
      isValidationError,
    };
  }

  /**
   * Returns normalize(error).message for D365FO service logging.
   */
  extractMessage(error: unknown): string {
    return this.normalize(error).message;
  }

  toError(
    error: unknown,
    context: { method: string; endpoint: string },
  ): DfoApiError {
    if (error instanceof DfoApiError) return error;
    const normalized = this.normalize(error);
    return new DfoApiError({
      ...normalized,
      method: context.method,
      endpoint: context.endpoint,
      responseData: this.responseData(error),
    });
  }

  private responseData(error: unknown): unknown {
    if (!error || typeof error !== 'object') return undefined;
    const response = (error as { response?: unknown }).response;
    if (!response || typeof response !== 'object') return undefined;
    return (response as { data?: unknown }).data;
  }
}
