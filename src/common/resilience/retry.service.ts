import { Injectable, Logger } from '@nestjs/common';
import axiosRetry, { IAxiosRetryConfig } from 'axios-retry';

export interface RetryOptions {
  retries?: number;
  retryDelay?: number;
  retryCondition?: (error: any) => boolean;
  exponentialBackoff?: boolean;
}

@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name);

  async executeWithRetry<T>(
    fn: () => Promise<T>,
    options?: RetryOptions,
  ): Promise<T> {
    const maxRetries = options?.retries || 3;
    const baseDelay = options?.retryDelay || 1000;
    const useExponentialBackoff = options?.exponentialBackoff !== false;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        if (options?.retryCondition && !options.retryCondition(error)) {
          throw error;
        }

        if (attempt < maxRetries) {
          const delay = useExponentialBackoff
            ? baseDelay * Math.pow(2, attempt)
            : baseDelay;

          this.logger.warn(
            `Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`,
          );

          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Retry failed');
  }

  configureAxiosRetry(axiosInstance: any, options?: RetryOptions): void {
    const retryConfig: IAxiosRetryConfig = {
      retries: options?.retries || 3,
      retryDelay: (retryCount) => {
        const baseDelay = options?.retryDelay || 1000;
        if (options?.exponentialBackoff !== false) {
          return baseDelay * Math.pow(2, retryCount);
        }
        return baseDelay;
      },
      retryCondition: options?.retryCondition || ((error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error);
      }),
      onRetry: (retryCount, error) => {
        this.logger.warn(
          `Axios retry attempt ${retryCount}: ${error.message}`,
        );
      },
    };

    axiosRetry(axiosInstance, retryConfig);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

