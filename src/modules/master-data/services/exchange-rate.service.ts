import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { IExchangeRate } from '@/modules/master-data/interfaces/exchange-rate.interface';
import { GetExchangeRatesQuery } from '@/modules/master-data/queries/get-exchange-rates.query';
import { MultiLayerCacheService } from '@/modules/resilience/services/mutli-layer-cache.service';

@Injectable()
export class ExchangeRateService {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly multiLayerCacheService: MultiLayerCacheService,
  ) {}

  async fetchExchangeRates(
    dateString: string,
    currency: string,
    rateType?: string,
  ): Promise<{ exchangeRate: number; reportingRate: number }> {
    const effectiveRateType = rateType ?? 'default';
    const [exchangeRate, reportingRate] = await Promise.all([
      this.queryExchangeRate(currency, dateString, 'EGP', effectiveRateType),
      this.queryExchangeRate(currency, dateString, 'USD', effectiveRateType),
    ]);
    return { exchangeRate, reportingRate };
  }

  async queryExchangeRate(
    currency: string,
    date: string,
    toCurrency: 'EGP' | 'USD',
    rateType?: string,
  ): Promise<number> {
    const effectiveRateType = rateType ?? 'default';
    if (currency === toCurrency) return 100;

    const lookupKey = `exchange-rate:${effectiveRateType}:${currency}|${date}|${toCurrency}`;
    return this.multiLayerCacheService.get(lookupKey, async () =>
      this.resolveRate(currency, date, toCurrency, effectiveRateType),
    );
  }

  private async resolveRate(
    fromCurrency: string,
    date: string,
    toCurrency: string,
    rateType: string,
  ): Promise<number> {
    const rates = await this.loadExchangeRatesData(rateType);
    const rate = this.findRateByDate(rates, date, fromCurrency, toCurrency);
    return rate ? Number(rate * 100) : 100;
  }

  private async loadExchangeRatesData(
    rateType: string,
  ): Promise<IExchangeRate[]> {
    const cacheKey = `exchange-rates:${rateType}:all`;
    return this.multiLayerCacheService.get(cacheKey, async () => {
      const result = await this.queryBus.execute(
        new GetExchangeRatesQuery({ rateTypeName: rateType }, 0, 10000),
      );
      return result?.items ?? [];
    });
  }

  private findRateByDate(
    rates: IExchangeRate[],
    dateStr: string,
    fromCurrency: string,
    toCurrency: string,
  ): number | null {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;

    const fromUpper = fromCurrency.toUpperCase();
    const toUpper = toCurrency.toUpperCase();

    const matching = rates.filter(
      (r) =>
        r.fromCurrency?.toUpperCase() === fromUpper &&
        r.toCurrency?.toUpperCase() === toUpper &&
        new Date(r.startDate).getTime() <= date.getTime() &&
        new Date(r.endDate).getTime() >= date.getTime(),
    );

    if (matching.length === 0) return null;
    if (matching.length === 1) return matching[0].rate;

    matching.sort(
      (a, b) =>
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );
    return matching[0].rate;
  }
}
