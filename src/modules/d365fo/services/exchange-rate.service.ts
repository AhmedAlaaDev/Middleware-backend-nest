import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

import { D365FOExchangeRate } from '@/modules/d365fo/types';

export interface ExchangeRateCurrencyRangeOptions {
  rateType?: string;
  fromCurrency: string;
  toCurrency: string;
  /** Inclusive YYYY-MM-DD lower bound. */
  startDate: string;
  /** Inclusive YYYY-MM-DD upper bound. */
  endDate: string;
  useCache?: boolean;
}

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
  ): Promise<D365FOExchangeRate[]> {
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
      filters.push(this.queryBuilder.ge('StartDate', fromDate.toISOString()));
    }

    if (toDate) {
      filters.push(this.queryBuilder.le('EndDate', toDate.toISOString()));
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

    const response = await this.d365foClient.get<D365FOExchangeRate>(query, {
      useCache,
      cacheTtl: 15 * 60 * 1000, // 15 minutes - exchange rates change frequently
    });

    return response.value;
  }

  /**
   * Fetch every validity period that overlaps one source-currency date range.
   *
   * This deliberately performs one non-paginated request. Cash-out imports
   * call it once per unique foreign currency and retain the returned periods
   * in their own per-import memory context.
   */
  public async getExchangeRatesForCurrencyRange(
    company: string,
    options: ExchangeRateCurrencyRangeOptions,
  ): Promise<D365FOExchangeRate[]> {
    const rateType = options.rateType?.trim() || 'Default';
    const fromCurrency = options.fromCurrency.trim().toUpperCase();
    const toCurrency = options.toCurrency.trim().toUpperCase();
    const startOfRange = this.toUtcDayBoundary(options.startDate, false);
    const endOfRange = this.toUtcDayBoundary(options.endDate, true);

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('RateTypeName', rateType),
      this.queryBuilder.eq('FromCurrency', fromCurrency),
      this.queryBuilder.eq('ToCurrency', toCurrency),
      // Return periods that overlap the requested file window. Requiring a
      // period to start inside the window would omit a rate already in effect
      // on the first transaction date.
      this.queryBuilder.geDateTime('EndDate', startOfRange),
      this.queryBuilder.leDateTime('StartDate', endOfRange),
    );

    const query = this.queryBuilder.buildQuery('/data/ExchangeRates', {
      filter,
      top: 10000,
      select: [
        'RateTypeName',
        'FromCurrency',
        'ToCurrency',
        'StartDate',
        'EndDate',
        'Rate',
        'ConversionFactor',
      ],
      orderBy: 'StartDate asc',
      crossCompany: true,
    });

    this.logger.debug(
      `Fetching ${rateType} exchange rates for ${fromCurrency}->${toCurrency}, ${options.startDate}..${options.endDate}, company: ${company}`,
    );

    const response = await this.d365foClient.get<D365FOExchangeRate>(query, {
      useCache: options.useCache ?? false,
      cacheTtl: 15 * 60 * 1000,
    });

    return response.value;
  }

  private toUtcDayBoundary(dateOnly: string, endOfDay: boolean): string {
    const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      throw new Error(`Invalid exchange-rate range date: ${dateOnly}`);
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        endOfDay ? 23 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 999 : 0,
      ),
    );

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new Error(`Invalid exchange-rate range date: ${dateOnly}`);
    }

    return date.toISOString();
  }
}
