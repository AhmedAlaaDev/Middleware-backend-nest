import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';

import { D365FOConfig, IConfig } from '@/config';
import { D365FOAuthService } from '@/modules/d365fo/services/d365fo-auth.service';
import { DfoErrorExtractorService } from '@/modules/d365fo/services/dfo-error-extractor.service';
import { D365FOODataResponse } from '@/modules/d365fo/types/d365fo-odata.type';
import { configureSystemCertificateAuthorities } from '@/modules/d365fo/utils/configure-system-ca';
import { LogPayloadService } from '@/modules/observability/services/log-payload.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { CacheService } from '@/modules/resilience/services/cache.service';
import { CircuitBreakerService } from '@/modules/resilience/services/circuit-breaker.service';
import { RetryService } from '@/modules/resilience/services/retry.service';

/**
 * Base HTTP client service for D365FO API requests
 * Handles authentication, circuit breaking, retries, and caching
 */
@Injectable()
export class D365FOClientService {
  private readonly logger = new Logger(D365FOClientService.name);
  private readonly resource: string;
  private readonly circuitBreaker: any;

  constructor(
    private readonly httpService: HttpService,
    private readonly authService: D365FOAuthService,
    private readonly cacheService: CacheService,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly retryService: RetryService,
    private readonly configService: ConfigService<IConfig>,
    private readonly operationalLogs: OperationalLoggerService,
    private readonly logPayloads: LogPayloadService,
    private readonly dfoErrors: DfoErrorExtractorService,
  ) {
    const systemCa = configureSystemCertificateAuthorities();
    if (systemCa.configured) {
      this.logger.log(
        `TLS trust initialized with ${systemCa.totalCertificateCount} CA certificate(s), including ${systemCa.systemCertificateCount} from the operating system (${systemCa.addedCertificateCount} newly added)`,
      );
    } else {
      this.logger.warn(
        systemCa.supported
          ? `Could not initialize operating-system CA trust: ${systemCa.error ?? 'unknown error'}`
          : 'This Node.js version cannot load the operating-system CA store at runtime; use Node 22.19+ or configure NODE_EXTRA_CA_CERTS.',
      );
    }

    this.resource =
      this.configService.get<D365FOConfig>('d365fo')?.resource || '';

    // Configure retry for HTTP service (429 = Too Many Requests: delay 2 min and continue retrying)
    this.retryService.configureAxiosRetry(this.httpService.axiosRef, {
      retries: 3,
      exponentialBackoff: true,
      retryCondition: (error: AxiosError) => {
        return (
          error.response?.status === undefined ||
          error.response?.status === 429 ||
          error.response.status >= 500 ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT'
        );
      },
    });

    // Create circuit breaker for GET requests
    this.circuitBreaker = this.circuitBreakerService.createCircuitBreaker(
      'd365fo-api',
      async (url: string, config?: any) => {
        const token = await this.authService.getAuthorizationHeader();
        const response = await firstValueFrom(
          this.httpService.get(url, {
            ...config,
            headers: {
              ...config?.headers,
              Authorization: token,
            },
          }),
        );
        return response.data;
      },
    );
  }

  /**
   * Get the base D365FO resource URL
   */
  public getResourceUrl(): string {
    return this.resource;
  }

  /**
   * Execute GET request with caching and circuit breaker
   * Returns data wrapped in D365FOODataResponse format
   */
  public async get<T>(
    endpoint: string,
    options?: {
      useCache?: boolean;
      cacheTtl?: number;
      headers?: Record<string, string>;
    },
  ): Promise<D365FOODataResponse<T>> {
    const {
      useCache = true,
      cacheTtl = 60 * 1000,
      headers = {},
    } = options || {};
    const cacheKey = `d365fo:${endpoint}`;

    if (useCache) {
      const cached =
        await this.cacheService.get<D365FOODataResponse<T>>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for: ${endpoint}`);
        return cached;
      }
    }

    const fullUrl = `${this.resource}${endpoint}`;
    let responseData: any;

    try {
      responseData = await this.circuitBreaker.fire(fullUrl, { headers });
    } catch (error) {
      const dfoError = this.dfoErrors.toError(error, {
        method: 'GET',
        endpoint,
      });
      this.logger.error(
        `D365FO API GET failed: ${endpoint} - ${dfoError.message}`,
      );
      throw dfoError;
    }

    // Ensure response is in OData format
    let data: D365FOODataResponse<T>;
    if (Array.isArray(responseData)) {
      // If response is already an array, wrap it in OData format
      data = {
        value: responseData as T[],
      };
    } else if (
      responseData &&
      typeof responseData === 'object' &&
      'value' in responseData
    ) {
      // Already in OData format
      data = responseData as D365FOODataResponse<T>;
    } else {
      // Single object - wrap in array
      data = {
        value: [responseData] as T[],
      };
    }

    if (useCache) {
      await this.cacheService.set(cacheKey, data, cacheTtl);
    }

    return data;
  }

  /**
   * Execute POST request with retry logic
   */
  public async post<TRequest, TResponse>(
    endpoint: string,
    data: TRequest,
    options?: {
      headers?: Record<string, string>;
      /** Per-request Axios timeout in ms (overrides HttpModule default). */
      timeout?: number;
      /**
       * Override executeWithRetry attempts. Use `0` for bulk mutations where a
       * client timeout must not re-submit (FO may still be committing).
       */
      retries?: number;
    },
  ): Promise<TResponse> {
    const fullUrl = `${this.resource}${endpoint}`;
    const { headers = {}, timeout, retries } = options || {};

    return this.traceMutation(
      'POST',
      endpoint,
      () =>
        this.retryService.executeWithRetry(
          async () => {
            const token = await this.authService.getAuthorizationHeader();
            const response = await firstValueFrom(
              this.httpService.post<TResponse>(fullUrl, data, {
                ...(timeout !== undefined ? { timeout } : {}),
                headers: {
                  Authorization: token,
                  'Content-Type': 'application/json',
                  ...headers,
                },
              }),
            );
            return response.data;
          },
          retries !== undefined ? { retries } : undefined,
        ),
      data,
    );
  }

  /**
   * Execute PATCH request with retry logic
   */
  public async patch<TRequest, TResponse>(
    endpoint: string,
    data: TRequest,
    options?: {
      headers?: Record<string, string>;
    },
  ): Promise<TResponse> {
    const fullUrl = `${this.resource}${endpoint}`;
    const { headers = {} } = options || {};

    return this.traceMutation(
      'PATCH',
      endpoint,
      () =>
        this.retryService.executeWithRetry(async () => {
          const token = await this.authService.getAuthorizationHeader();
          const response = await firstValueFrom(
            this.httpService.patch<TResponse>(fullUrl, data, {
              headers: {
                Authorization: token,
                'Content-Type': 'application/json',
                ...headers,
              },
            }),
          );

          return response.data;
        }),
      data,
    );
  }

  /**
   * Execute DELETE request with retry logic
   */
  public async delete<TResponse>(
    endpoint: string,
    options?: {
      headers?: Record<string, string>;
    },
  ): Promise<TResponse> {
    const fullUrl = `${this.resource}${endpoint}`;
    const { headers = {} } = options || {};

    return this.traceMutation('DELETE', endpoint, () =>
      this.retryService.executeWithRetry(async () => {
        const token = await this.authService.getAuthorizationHeader();
        const response = await firstValueFrom(
          this.httpService.delete<TResponse>(fullUrl, {
            headers: {
              Authorization: token,
              ...headers,
            },
          }),
        );

        return response.data;
      }),
    );
  }

  /**
   * Wrap a mutating call so the complete request body, the response body, and
   * the outcome land on a single operational log event.
   */
  private async traceMutation<T>(
    method: string,
    endpoint: string,
    request: () => Promise<T>,
    requestBody?: unknown,
  ): Promise<T> {
    const startedAt = Date.now();
    const metadata = {
      method,
      endpoint,
      url: `${this.resource}${endpoint}`,
    };

    try {
      const response = await request();
      await this.operationalLogs.emit({
        level: 'info',
        message: `${method} ${endpoint} completed`,
        context: D365FOClientService.name,
        eventType: 'd365fo.request.completed',
        status: 'completed',
        durationMs: Date.now() - startedAt,
        metadata,
        payload: this.logPayloads.captureExchange(requestBody, response),
      });
      return response;
    } catch (error) {
      const dfoError = this.dfoErrors.toError(error, { method, endpoint });
      const httpStatus = (error as AxiosError)?.response?.status;
      await this.operationalLogs.emit({
        level: 'error',
        message: `${method} ${endpoint} failed`,
        context: D365FOClientService.name,
        eventType: 'd365fo.request.failed',
        status: 'failed',
        durationMs: Date.now() - startedAt,
        error: {
          name: dfoError.name,
          message: dfoError.message,
          stack: dfoError.stack,
        },
        metadata: {
          ...metadata,
          ...(httpStatus ? { httpStatus } : {}),
        },
        payload: this.logPayloads.captureExchange(
          requestBody,
          (error as AxiosError)?.response?.data,
        ),
      });
      throw dfoError;
    }
  }
}
