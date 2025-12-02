import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';

/**
 * Service for managing exchange rates in D365FO
 */
@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  constructor(private readonly d365foClient: D365FOClientService) {}

  /**
   * Get exchange rates for a specific company and rate type
   */
  public async getExchangeRates(
    company: string,
    options?: {
      rateType?: string;
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
    },
  ): Promise<any[]> {
    const {
      rateType = 'Default',
      skipCount = 0,
      maxCount = 250,
      useCache = true,
    } = options || {};

    const query = `/data/ExchangeRates?cross-company=true&$filter=RateTypeName eq '${rateType}'&$top=${maxCount}&$skip=${skipCount}`;

    this.logger.debug(
      `Fetching exchange rates for company: ${company}, rateType: ${rateType}`,
    );

    return this.d365foClient.get<any[]>(query, {
      useCache,
      cacheTtl: 15 * 60 * 1000, // 15 minutes - exchange rates change frequently
    });
  }
}

