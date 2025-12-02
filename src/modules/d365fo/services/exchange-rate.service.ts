import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

/**
 * Service for managing exchange rates in D365FO
 */
@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

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
      select?: string[];
      orderBy?: string | string[];
      fromDate?: Date;
      toDate?: Date;
    },
  ): Promise<any[]> {
    const {
      rateType = 'Default',
      skipCount = 0,
      maxCount = 250,
      useCache = true,
      select,
      orderBy,
      fromDate,
      toDate,
    } = options || {};

    const filters: string[] = [this.queryBuilder.eq('RateTypeName', rateType)];

    if (fromDate) {
      filters.push(this.queryBuilder.ge('ValidFrom', fromDate.toISOString()));
    }

    if (toDate) {
      filters.push(this.queryBuilder.le('ValidTo', toDate.toISOString()));
    }

    const filter = this.queryBuilder.and(...filters);

    const query = this.queryBuilder.buildQuery('/data/ExchangeRates', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(
      `Fetching exchange rates for company: ${company}, rateType: ${rateType}`,
    );

    return this.d365foClient.get<any[]>(query, {
      useCache,
      cacheTtl: 15 * 60 * 1000, // 15 minutes - exchange rates change frequently
    });
  }
}

