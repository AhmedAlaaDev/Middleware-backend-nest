import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { D365FOAuthService } from './d365fo-auth.service';
import { MultiLayerCacheService } from '../../cache/services/multi-layer-cache.service';
import { CircuitBreakerService } from '../../../common/resilience/circuit-breaker.service';
import { RetryService } from '../../../common/resilience/retry.service';
import { AxiosError } from 'axios';

@Injectable()
export class D365FODataService {
  private readonly logger = new Logger(D365FODataService.name);
  private readonly resource: string;
  private readonly circuitBreaker: any;

  constructor(
    private readonly httpService: HttpService,
    private readonly authService: D365FOAuthService,
    private readonly cache: MultiLayerCacheService,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly retryService: RetryService,
    private readonly configService: ConfigService,
  ) {
    this.resource =
      this.configService.get<string>('D365FO_RESOURCE') || '';

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

    // Create circuit breaker for D365FO API calls
    const circuitBreakerTimeout = this.configService.get<number>(
      'resilience.circuitBreaker.timeout',
      30000,
    );
    const circuitBreakerResetTimeout = this.configService.get<number>(
      'resilience.circuitBreaker.resetTimeout',
      30000,
    );

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
      {
        timeout: circuitBreakerTimeout,
        errorThresholdPercentage: this.configService.get<number>(
          'resilience.circuitBreaker.errorThresholdPercentage',
          50,
        ) || 50,
        resetTimeout: circuitBreakerResetTimeout,
      },
    );
  }

  /**
   * Get data from D365FO with caching and circuit breaker
   */
  async getDataAsync<T>(
    endpoint: string,
    useCache: boolean = true,
  ): Promise<T> {
    const cacheKey = `d365fo:${endpoint}`;

    if (useCache) {
      const l1Ttl = this.configService.get<number>('cache.l1Ttl', 300) * 1000;
      const l2Ttl = this.configService.get<number>('cache.l2Ttl', 1800) * 1000;

      return this.cache.get(
        cacheKey,
        async () => {
          return this.executeRequest<T>(endpoint);
        },
        {
          l1Ttl,
          l2Ttl,
          skipL3: true, // Don't cache external API data in L3
        },
      );
    }

    return this.executeRequest<T>(endpoint);
  }

  /**
   * Post data to D365FO with circuit breaker
   */
  async postDataAsync<TRequest, TResponse>(
    endpoint: string,
    data: TRequest,
  ): Promise<TResponse> {
    const fullUrl = `${this.resource}${endpoint}`;

    return this.retryService.executeWithRetry(async () => {
      const token = await this.authService.getAuthorizationHeader();
      const response = await firstValueFrom(
        this.httpService.post<TResponse>(fullUrl, data, {
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
        }),
      );

      return response.data;
    });
  }

  /**
   * Execute request through circuit breaker
   */
  private async executeRequest<T>(endpoint: string): Promise<T> {
    const fullUrl = `${this.resource}${endpoint}`;

    try {
      return await this.circuitBreaker.fire(fullUrl);
    } catch (error: any) {
      this.logger.error(
        `D365FO API call failed: ${endpoint} - ${error.message}`,
      );
      throw error;
    }
  }

  // D365FO specific methods (mirrored from .NET)

  async getBillingCodeListAsync(
    company: string,
    billingClassId: string,
    skipCount: number = 0,
    maxCount: number = 5000,
  ): Promise<any[]> {
    const query = `/data/BillingClassificationCodes?cross-company=true&$filter=dataAreaId eq '${company}' and BillingClassification eq '${billingClassId}'&$top=${maxCount}&$skip=${skipCount}`;
    return this.getDataAsync<any[]>(query);
  }

  async getBillingClassificationListAsync(
    company: string,
    skipCount: number = 0,
    maxCount: number = 5000,
  ): Promise<any[]> {
    const query = `/data/BillingClassifications?cross-company=true&$filter=dataAreaId eq '${company}'&$top=${maxCount}&$skip=${skipCount}`;
    return this.getDataAsync<any[]>(query);
  }

  async getDimensionListAsync(
    skipCount: number = 0,
    maxCount: number = 5000,
  ): Promise<any[]> {
    const query = `/data/DimensionAttributes?cross-company=true&$top=${maxCount}&$skip=${skipCount}`;
    return this.getDataAsync<any[]>(query);
  }

  async getDimensionValueListAsync(
    dimension: string,
    company: string,
    skipCount: number = 0,
    maxCount: number = 5000,
  ): Promise<any[]> {
    const query = `/data/FinancialDimensionValues?cross-company=true&$filter=(LegalEntityId eq '${company}' and FinancialDimension eq '${dimension}') or (LegalEntityId eq '' and FinancialDimension eq '${dimension}')&$top=${maxCount}&$skip=${skipCount}`;
    return this.getDataAsync<any[]>(query);
  }

  async getExchangeRateAsync(
    company: string,
    rateType: string = 'Default',
    skipCount: number = 0,
    maxCount: number = 250,
  ): Promise<any[]> {
    const query = `/data/ExchangeRates?cross-company=true&$filter=RateTypeName eq '${rateType}'&$top=${maxCount}&$skip=${skipCount}`;
    return this.getDataAsync<any[]>(query);
  }

  // Create methods
  async createCustomerInvoiceHeaderAsync(
    company: string,
    data: any,
  ): Promise<any> {
    return this.postDataAsync<any, any>('/data/FreeTextInvoiceHeaders', {
      ...data,
      DataAreaId: company,
    });
  }

  async createCustomerInvoiceLineAsync(
    company: string,
    invoiceNumber: number,
    data: any,
  ): Promise<any> {
    return this.postDataAsync<any, any>('/data/FreeTextInvoiceLines', {
      ...data,
      DataAreaId: company,
      ParentRecId: invoiceNumber,
    });
  }

  async createGeneralJournalHeaderAsync(
    company: string,
    data: any,
  ): Promise<any> {
    return this.postDataAsync<any, any>('/data/LedgerJournalHeaders', {
      ...data,
      DataAreaId: company,
    });
  }

  async createGeneralJournalLineAsync(
    company: string,
    data: any,
  ): Promise<any> {
    return this.postDataAsync<any, any>('/data/LedgerJournalLines', {
      ...data,
      DataAreaId: company,
    });
  }
}

