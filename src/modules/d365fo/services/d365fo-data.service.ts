import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';

import { D365FOConfig, IConfig } from '@/config';
import { D365FOAuthService } from '@/modules/d365fo/services/d365fo-auth.service';
import { CacheService } from '@/modules/resilience/services/cache.service';
import { CircuitBreakerService } from '@/modules/resilience/services/circuit-breaker.service';
import { RetryService } from '@/modules/resilience/services/retry.service';

@Injectable()
export class D365FODataService {
  private readonly logger = new Logger(D365FODataService.name);
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
   * Get data from D365FO with caching and circuit breaker
   */
  public async getDataAsync<T>(
    endpoint: string,
    useCache: boolean = true,
  ): Promise<T> {
    const cacheKey = `d365fo:${endpoint}`;

    if (useCache) {
      let data = await this.cacheService.get<T>(cacheKey);

      if (data) {
        return data;
      }

      data = await this.executeRequest<T>(endpoint);

      await this.cacheService.set(cacheKey, data, 1000 * 60);

      return data;
    }

    return this.executeRequest<T>(endpoint);
  }

  /**
   * Post data to D365FO with circuit breaker
   */
  public postDataAsync<TRequest, TResponse>(
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

  public async getBillingCodeListAsync(
    company: string,
    billingClassId: string,
    skipCount: number = 0,
    maxCount: number = 5000,
  ): Promise<any[]> {
    const query = `/data/BillingClassificationCodes?cross-company=true&$filter=dataAreaId eq '${company}' and BillingClassification eq '${billingClassId}'&$top=${maxCount}&$skip=${skipCount}`;
    return this.getDataAsync<any[]>(query);
  }

  public async getBillingClassificationListAsync(
    company: string,
    skipCount: number = 0,
    maxCount: number = 5000,
  ): Promise<any[]> {
    const query = `/data/BillingClassifications?cross-company=true&$filter=dataAreaId eq '${company}'&$top=${maxCount}&$skip=${skipCount}`;
    return this.getDataAsync<any[]>(query);
  }

  public async getDimensionListAsync(
    skipCount: number = 0,
    maxCount: number = 5000,
  ): Promise<any[]> {
    const query = `/data/DimensionAttributes?cross-company=true&$top=${maxCount}&$skip=${skipCount}`;
    return this.getDataAsync<any[]>(query);
  }

  public async getDimensionValueListAsync(
    dimension: string,
    company: string,
    skipCount: number = 0,
    maxCount: number = 5000,
  ): Promise<any[]> {
    const query = `/data/FinancialDimensionValues?cross-company=true&$filter=(LegalEntityId eq '${company}' and FinancialDimension eq '${dimension}') or (LegalEntityId eq '' and FinancialDimension eq '${dimension}')&$top=${maxCount}&$skip=${skipCount}`;
    return this.getDataAsync<any[]>(query);
  }

  public async getExchangeRateAsync(
    company: string,
    rateType: string = 'Default',
    skipCount: number = 0,
    maxCount: number = 250,
  ): Promise<any[]> {
    const query = `/data/ExchangeRates?cross-company=true&$filter=RateTypeName eq '${rateType}'&$top=${maxCount}&$skip=${skipCount}`;
    return this.getDataAsync<any[]>(query);
  }

  // Create methods
  public async createCustomerInvoiceHeaderAsync(
    company: string,
    data: any,
  ): Promise<any> {
    return this.postDataAsync<any, any>('/data/FreeTextInvoiceHeaders', {
      ...data,
      DataAreaId: company,
    });
  }

  public async createCustomerInvoiceLineAsync(
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

  public async createGeneralJournalHeaderAsync(
    company: string,
    data: any,
  ): Promise<any> {
    return this.postDataAsync<any, any>('/data/LedgerJournalHeaders', {
      ...data,
      DataAreaId: company,
    });
  }

  public async createGeneralJournalLineAsync(
    company: string,
    data: any,
  ): Promise<any> {
    return this.postDataAsync<any, any>('/data/LedgerJournalLines', {
      ...data,
      DataAreaId: company,
    });
  }
}
