import { Injectable } from '@nestjs/common';

/**
 * Required normalized shape for D365FO errors. Used by all callers;
 * no ad-hoc parsing of error.response.data elsewhere.
 */
export type DfoErrorShape = {
  message: string;
  status?: number;
  code?: string;
  isConcurrencyConflict?: boolean;
  isDependentLinesError?: boolean;
  isValidationError?: boolean;
  raw?: unknown;
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

@Injectable()
export class DfoErrorExtractorService {
  /**
   * Normalizes any thrown value from D365FO (Axios-style or OData) into a stable shape.
   * Callers MUST use this instead of parsing error.response.data manually.
   */
  normalize(error: unknown): DfoErrorShape {
    const raw = error;
    const status =
      typeof (error as any)?.response?.status === 'number'
        ? (error as any).response.status
        : undefined;

    let message = '';
    let code: string | undefined;

    const d365foError = (error as any)?.response?.data?.error;
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
      } else if (typeof d365foError === 'string') {
        message = d365foError;
      }
    }

    if (!message && (error as any)?.response?.data?.error_description) {
      message = (error as any).response.data.error_description;
    }
    if (!message && (error as any)?.response?.data?.message) {
      message = (error as any).response.data.message;
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

    const isValidationError =
      status === 400 &&
      (fullText.includes('validation') || fullText.includes('invalid'));

    return {
      message,
      status,
      code,
      isConcurrencyConflict,
      isDependentLinesError,
      isValidationError,
      raw,
    };
  }

  /**
   * Returns normalize(error).message. Use for logging and error collector.
   */
  extractMessage(error: unknown): string {
    return this.normalize(error).message;
  }
}
