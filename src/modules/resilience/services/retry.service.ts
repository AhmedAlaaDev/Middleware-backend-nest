import { Logger } from '@nestjs/common';
import axiosRetry, { IAxiosRetryConfig } from 'axios-retry';
import { AxiosError } from 'axios';

export interface RetryOptions {
  retries?: number;
  retryDelay?: number;
  retryCondition?: (error: any) => boolean;
  exponentialBackoff?: boolean;
}

export class RetryService {
  private readonly logger = new Logger(RetryService.name);

  /**
   * Default retry condition that only retries on connection errors and 5xx errors
   * Does NOT retry on 4xx client errors
   */
  private shouldRetry(error: any): boolean {
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
    const status = error.response?.status;
    if (status && status >= 500 && status < 600) {
      return true;
    }

    // 4xx client errors - should NOT retry
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
    const maxRetries = options?.retries || 3;
    const baseDelay = options?.retryDelay || 1000;
    const useExponentialBackoff = options?.exponentialBackoff !== false;

    // Use custom retry condition if provided, otherwise use default
    const retryCondition = options?.retryCondition || this.shouldRetry.bind(this);

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
          const delay = useExponentialBackoff
            ? baseDelay * Math.pow(2, attempt)
            : baseDelay;

          this.logger.warn(
            `Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms (status: ${error.response?.status || 'network error'}, code: ${error.code || 'N/A'})`,
          );

          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Retry failed');
  }

  public configureAxiosRetry(axiosInstance: any, options?: RetryOptions): void {
    // Use custom retry condition if provided, otherwise use default
    const retryCondition = options?.retryCondition || this.shouldRetry.bind(this);

    const retryConfig: IAxiosRetryConfig = {
      retries: options?.retries || 3,
      retryDelay: (retryCount) => {
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
        this.logger.warn(
          `Axios retry attempt ${retryCount}: ${error.message} (status: ${status || 'network error'}, code: ${code || 'N/A'})`,
        );
      },
    };

    axiosRetry(axiosInstance, retryConfig);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
