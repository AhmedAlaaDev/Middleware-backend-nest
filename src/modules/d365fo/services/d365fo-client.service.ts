import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';

import { D365FOConfig, IConfig } from '@/config';
import { D365FOAuthService } from '@/modules/d365fo/services/d365fo-auth.service';
import { D365FOODataResponse } from '@/modules/d365fo/types/d365fo-odata.type';
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
  ) {
    this.resource =
      this.configService.get<D365FOConfig>('d365fo')?.resource || '';

    // Configure retry for HTTP service
    this.retryService.configureAxiosRetry(this.httpService.axiosRef, {
      retries: 3,
      exponentialBackoff: true,
      retryCondition: (error: AxiosError) => {
        return (
          error.response?.status === undefined ||
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
    } catch (error: any) {
      this.logger.error(
        `D365FO API GET failed: ${endpoint} - ${error.message}`,
      );
      throw error;
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
    },
  ): Promise<TResponse> {
    const fullUrl = `${this.resource}${endpoint}`;
    const { headers = {} } = options || {};

    return this.retryService.executeWithRetry(async () => {
      const token = await this.authService.getAuthorizationHeader();
      const response = await firstValueFrom(
        this.httpService.post<TResponse>(fullUrl, data, {
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
            ...headers,
          },
        }),
      );

      return response.data;
    });
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

    return this.retryService.executeWithRetry(async () => {
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
    });
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

    return this.retryService.executeWithRetry(async () => {
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
    });
  }
}
