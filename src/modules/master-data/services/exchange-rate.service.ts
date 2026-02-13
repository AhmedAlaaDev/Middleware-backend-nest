import { Injectable } from '@nestjs/common';

import { IExchangeRate } from '@/modules/master-data/interfaces/exchange-rate.interface';

/** Map: rateType -> pairIndex (pairKey -> IExchangeRate[]) */
export type ExchangeRateMap = Map<string, Map<string, IExchangeRate[]>>;

@Injectable()
export class ExchangeRateService {
  /**
   * Builds pair key index (e.g. USD|EGP -> rates). Base fetches raw IExchangeRate[],
   * calls this, stores in exchangeRateMap by rateType.
   */
  buildRatesIndexByPair(rates: IExchangeRate[]): Map<string, IExchangeRate[]> {
    const index = new Map<string, IExchangeRate[]>();
    for (const r of rates) {
      const from = r.fromCurrency?.toUpperCase() ?? '';
      const to = r.toCurrency?.toUpperCase() ?? '';
      const key = `${from}|${to}`;
      const existing = index.get(key) ?? [];
      existing.push(r);
      index.set(key, existing);
    }
    return index;
  }

  /**
   * Finds rate by date using preloaded pair index. Pure sync lookup.
   */
  findRateByDate(
    pairIndex: Map<string, IExchangeRate[]>,
    dateStr: string,
    fromCurrency: string,
    toCurrency: string,
  ): number | null {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;

    const fromUpper = fromCurrency.toUpperCase();
    const toUpper = toCurrency.toUpperCase();
    const pairKey = `${fromUpper}|${toUpper}`;

    const pairRates = pairIndex.get(pairKey) ?? [];

    const matching = pairRates.filter(
      (r) =>
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

  queryExchangeRate(
    exchangeRateMap: ExchangeRateMap,
    rateType: string,
    currency: string,
    date: string,
    toCurrency: 'EGP' | 'USD',
  ): number {
    if (currency === toCurrency) return 100;

    const pairIndex = exchangeRateMap.get(rateType);
    if (!pairIndex) return 100;

    const rate = this.findRateByDate(pairIndex, date, currency, toCurrency);
    return rate ? Number(rate * 100) : 100;
  }

  fetchExchangeRates(
    exchangeRateMap: ExchangeRateMap,
    rateType: string,
    dateString: string,
    currency: string,
  ): { exchangeRate: number; reportingRate: number } {
    const exchangeRate = this.queryExchangeRate(
      exchangeRateMap,
      rateType,
      currency,
      dateString,
      'EGP',
    );
    const reportingRate = this.queryExchangeRate(
      exchangeRateMap,
      rateType,
      currency,
      dateString,
      'USD',
    );
    return { exchangeRate, reportingRate };
  }
}
