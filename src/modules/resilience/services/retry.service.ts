import { Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import axiosRetry, { IAxiosRetryConfig } from 'axios-retry';

export interface RetryOptions {
  retries?: number;
  retryDelay?: number;
  retryCondition?: (error: any) => boolean;
  exponentialBackoff?: boolean;
}

/** Delay in ms when server returns 429 Too Many Requests (2 minutes) */
const DELAY_MS_429 = 2 * 60 * 1000;

export class RetryService {
  private readonly logger = new Logger(RetryService.name);

  /**
   * Default retry condition that only retries on connection errors, 5xx errors, and 429 Too Many Requests
   * Does NOT retry on other 4xx client errors
   */
  private shouldRetry(error: any): boolean {
    const status = error.response?.status;

    // 429 Too Many Requests - retry after delay (rate limit)
    if (status === 429) {
      return true;
    }

    // Network errors (no response) - should retry
    if (!error.response) {
      // Check for connection-related error codes
      const connectionErrorCodes = [
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ECONNREFUSED',
        'EAI_AGAIN',
        'EPIPE',
        'ENETUNREACH',
        'EHOSTUNREACH',
      ];

      if (error.code && connectionErrorCodes.includes(error.code)) {
        return true;
      }

      // Network errors without specific code should also be retried
      return true;
    }

    // 5xx server errors - should retry
    if (status && status >= 500 && status < 600) {
      return true;
    }

    // 400 with D365FO concurrency/update conflict - retryable (transient locking)
    if (status === 400) {
      const message = this.getErrorMessage(error).toLowerCase();
      const retryableConflictPhrases = [
        'update conflict',
        'cannot edit a record in ledger journal table',
        'cannot edit a record',
        'another user process deleting the record',
        'another user process',
      ];
      if (retryableConflictPhrases.some((phrase) => message.includes(phrase))) {
        return true;
      }
    }

    // Other 4xx client errors - should NOT retry (429 already handled above)
    if (status && status >= 400 && status < 500) {
      return false;
    }

    // For other cases (e.g., 3xx), use axios-retry's default logic
    return axiosRetry.isNetworkOrIdempotentRequestError(error);
  }

  public async executeWithRetry<T>(
    fn: () => Promise<T>,
    options?: RetryOptions,
  ): Promise<T> {
    const maxRetries = options?.retries ?? 3;
    const baseDelay = options?.retryDelay || 1000;
    const useExponentialBackoff = options?.exponentialBackoff !== false;

    // Use custom retry condition if provided, otherwise use default
    const retryCondition =
      options?.retryCondition || this.shouldRetry.bind(this);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        // Check if we should retry this error
        if (!retryCondition(error)) {
          this.logger.debug(
            `Error is not retryable (status: ${error.response?.status}, code: ${error.code}), throwing immediately`,
          );
          throw error;
        }

        if (attempt < maxRetries) {
          const is429 = error.response?.status === 429;
          const delay = is429
            ? DELAY_MS_429
            : useExponentialBackoff
              ? baseDelay * Math.pow(2, attempt)
              : baseDelay;

          this.logger.warn(
            is429
              ? `Retry attempt ${attempt + 1}/${maxRetries} after 2 min (429 Too Many Requests)`
              : `Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms (status: ${error.response?.status || 'network error'}, code: ${error.code || 'N/A'})`,
          );

          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Retry failed');
  }

  public configureAxiosRetry(axiosInstance: any, options?: RetryOptions): void {
    // Use custom retry condition if provided, otherwise use default
    const retryCondition =
      options?.retryCondition || this.shouldRetry.bind(this);

    const retryConfig: IAxiosRetryConfig = {
      retries: options?.retries || 3,
      retryDelay: (retryCount, error: AxiosError) => {
        if (error?.response?.status === 429) {
          return DELAY_MS_429;
        }
        const baseDelay = options?.retryDelay || 1000;
        if (options?.exponentialBackoff !== false) {
          return baseDelay * Math.pow(2, retryCount);
        }
        return baseDelay;
      },
      retryCondition: retryCondition,
      onRetry: (retryCount, error: AxiosError) => {
        const status = error.response?.status;
        const code = error.code;
        const delayMsg = status === 429 ? ', delaying 2 min before retry' : '';
        this.logger.warn(
          `Axios retry attempt ${retryCount}: ${error.message} (status: ${status || 'network error'}, code: ${code || 'N/A'}${delayMsg})`,
        );
      },
    };

    axiosRetry(axiosInstance, retryConfig);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract a single string from an Axios/D365FO error for message matching.
   * Handles response.data as string, object with message/error, or nested error.
   * D365FO often puts the detailed Infolog in error.innererror.message.
   */
  private getErrorMessage(error: any): string {
    const msg = error?.message ?? '';
    const data = error?.response?.data;
    if (data == null) return msg;
    if (typeof data === 'string') return `${msg} ${data}`.trim();
    const main = data?.error?.message ?? data?.message ?? data?.value ?? '';
    const innerMessage = data?.error?.innererror?.message ?? '';
    const mainStr = Array.isArray(main) ? main.join(' ') : String(main ?? '');
    const innerStr =
      typeof innerMessage === 'string'
        ? innerMessage
        : Array.isArray(innerMessage)
          ? innerMessage.join(' ')
          : String(innerMessage ?? '');
    return `${msg} ${mainStr} ${innerStr}`.trim();
  }
}
