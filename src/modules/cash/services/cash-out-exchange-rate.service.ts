import { Injectable } from '@nestjs/common';

import { ExchangeRateService as D365FOExchangeRateService } from '@/modules/d365fo/services/exchange-rate.service';
import { D365FOExchangeRate } from '@/modules/d365fo/types';
import { EntryRawDataModel } from '@/modules/entry-processor/models';

export interface CashOutExchangeRateContext {
  earliestTransactionDate: string | null;
  latestTransactionDate: string | null;
  requestEndDate: string | null;
  ratesByCurrency: ReadonlyMap<string, readonly D365FOExchangeRate[]>;
  reportingRatesByCurrency: ReadonlyMap<string, readonly D365FOExchangeRate[]>;
}

export type CashOutExchangeRateResolution =
  | { kind: 'matched'; rate: number }
  | { kind: 'not-required'; rate: 100 }
  | { kind: 'missing'; rate: 0; message: string };

/**
 * Task 2047 & 2048 exchange-rate loader and in-memory matcher for Cash files.
 * The returned context belongs to one processing invocation, avoiding mutable
 * singleton state when multiple uploads are formatted concurrently.
 */
@Injectable()
export class CashOutExchangeRateService {
  private static readonly BASE_CURRENCY = 'EGP';
  private static readonly REPORTING_CURRENCY = 'USD';
  private static readonly RATE_TYPE = 'Default';

  constructor(
    private readonly d365ExchangeRateService: D365FOExchangeRateService,
  ) {}

  public async load(
    company: string,
    lines: EntryRawDataModel[],
  ): Promise<CashOutExchangeRateContext> {
    const transactionDates = lines
      .map((line) => this.normalizeDateOnly(line.TRANSDATE))
      .filter((date): date is string => Boolean(date))
      .sort();

    const earliestTransactionDate = transactionDates[0] ?? null;
    const latestTransactionDate =
      transactionDates[transactionDates.length - 1] ?? null;
    const requestEndDate = latestTransactionDate
      ? this.lastDayOfMonth(latestTransactionDate)
      : null;

    const foreignCurrencies = [
      ...new Set(
        lines
          .map((line) => this.normalizeCurrency(line.CURRENCYCODE))
          .filter(
            (currency) =>
              Boolean(currency) &&
              currency !== CashOutExchangeRateService.BASE_CURRENCY,
          ),
      ),
    ].sort();

    const nonUsdCurrencies = [
      ...new Set(
        lines
          .map((line) => this.normalizeCurrency(line.CURRENCYCODE))
          .filter(
            (currency) =>
              Boolean(currency) &&
              currency !== CashOutExchangeRateService.REPORTING_CURRENCY,
          ),
      ),
    ].sort();

    const ratesByCurrency = new Map<string, readonly D365FOExchangeRate[]>();
    const reportingRatesByCurrency = new Map<
      string,
      readonly D365FOExchangeRate[]
    >();

    if (earliestTransactionDate && requestEndDate) {
      const [results, reportingResults] = await Promise.all([
        Promise.all(
          foreignCurrencies.map(async (fromCurrency) => {
            const rates =
              await this.d365ExchangeRateService.getExchangeRatesForCurrencyRange(
                company,
                {
                  rateType: CashOutExchangeRateService.RATE_TYPE,
                  fromCurrency,
                  toCurrency: CashOutExchangeRateService.BASE_CURRENCY,
                  startDate: earliestTransactionDate,
                  endDate: requestEndDate,
                  useCache: false,
                },
              );

            return [fromCurrency, Object.freeze([...(rates || [])])] as const;
          }),
        ),
        Promise.all(
          nonUsdCurrencies.map(async (fromCurrency) => {
            const rates =
              await this.d365ExchangeRateService.getExchangeRatesForCurrencyRange(
                company,
                {
                  rateType: CashOutExchangeRateService.RATE_TYPE,
                  fromCurrency,
                  toCurrency: CashOutExchangeRateService.REPORTING_CURRENCY,
                  startDate: earliestTransactionDate,
                  endDate: requestEndDate,
                  useCache: false,
                },
              );

            return [fromCurrency, Object.freeze([...(rates || [])])] as const;
          }),
        ),
      ]);

      for (const [currency, rates] of results) {
        ratesByCurrency.set(currency, rates);
      }
      for (const [currency, rates] of reportingResults) {
        reportingRatesByCurrency.set(currency, rates);
      }
    }

    return {
      earliestTransactionDate,
      latestTransactionDate,
      requestEndDate,
      ratesByCurrency,
      reportingRatesByCurrency,
    };
  }

  public resolve(
    context: CashOutExchangeRateContext,
    transactionDate: string,
    currencyCode: string,
  ): CashOutExchangeRateResolution {
    const currency = this.normalizeCurrency(currencyCode);
    const date = this.normalizeDateOnly(transactionDate);

    if (currency === CashOutExchangeRateService.BASE_CURRENCY) {
      return { kind: 'not-required', rate: 100 };
    }

    if (!currency || !date) {
      return this.missing(currency || '(empty)', date || '(invalid date)');
    }

    const rates = context.ratesByCurrency.get(currency) ?? [];
    let selected: { startDate: string; rate: number } | null = null;

    for (const rate of rates) {
      if (
        this.normalizeCurrency(rate.FromCurrency) !== currency ||
        this.normalizeCurrency(rate.ToCurrency) !==
          CashOutExchangeRateService.BASE_CURRENCY ||
        (rate.RateTypeName || '').trim().toLowerCase() !==
          CashOutExchangeRateService.RATE_TYPE.toLowerCase()
      ) {
        continue;
      }

      const startDate = this.normalizeDateOnly(rate.StartDate);
      const endDate = this.normalizeDateOnly(rate.EndDate);
      const numericRate = Number(rate.Rate);

      if (
        !startDate ||
        !endDate ||
        !Number.isFinite(numericRate) ||
        numericRate <= 0 ||
        date < startDate ||
        date > endDate
      ) {
        continue;
      }

      // If D365 contains overlapping periods, use the one that became valid
      // most recently, matching the previous master-data selection rule.
      if (!selected || startDate > selected.startDate) {
        selected = { startDate, rate: numericRate };
      }
    }

    if (!selected) {
      return this.missing(currency, date);
    }

    // D365 journal exchange-rate fields use the percentage-rate convention
    // already used throughout this middleware (48.75 => 4875).
    return { kind: 'matched', rate: Number(selected.rate * 100) };
  }

  public resolveReporting(
    context: CashOutExchangeRateContext,
    transactionDate: string,
    currencyCode: string,
  ): CashOutExchangeRateResolution {
    const currency = this.normalizeCurrency(currencyCode);
    const date = this.normalizeDateOnly(transactionDate);

    if (currency === CashOutExchangeRateService.REPORTING_CURRENCY) {
      return { kind: 'not-required', rate: 100 };
    }

    if (!currency || !date) {
      return this.missingReporting(
        currency || '(empty)',
        date || '(invalid date)',
      );
    }

    const rates = context.reportingRatesByCurrency.get(currency) ?? [];
    let selected: { startDate: string; rate: number } | null = null;

    for (const rate of rates) {
      if (
        this.normalizeCurrency(rate.FromCurrency) !== currency ||
        this.normalizeCurrency(rate.ToCurrency) !==
          CashOutExchangeRateService.REPORTING_CURRENCY ||
        (rate.RateTypeName || '').trim().toLowerCase() !==
          CashOutExchangeRateService.RATE_TYPE.toLowerCase()
      ) {
        continue;
      }

      const startDate = this.normalizeDateOnly(rate.StartDate);
      const endDate = this.normalizeDateOnly(rate.EndDate);
      const numericRate = Number(rate.Rate);

      if (
        !startDate ||
        !endDate ||
        !Number.isFinite(numericRate) ||
        numericRate <= 0 ||
        date < startDate ||
        date > endDate
      ) {
        continue;
      }

      if (!selected || startDate > selected.startDate) {
        selected = { startDate, rate: numericRate };
      }
    }

    if (!selected) {
      return this.missingReporting(currency, date);
    }

    return { kind: 'matched', rate: Number(selected.rate * 100) };
  }

  private missing(
    currency: string,
    date: string,
  ): CashOutExchangeRateResolution {
    return {
      kind: 'missing',
      rate: 0,
      message: `No valid exchange rate found for ${currency} on ${date}`,
    };
  }

  private missingReporting(
    currency: string,
    date: string,
  ): CashOutExchangeRateResolution {
    return {
      kind: 'missing',
      rate: 0,
      message: `No valid reporting exchange rate found for ${currency} to USD on ${date}`,
    };
  }

  private normalizeCurrency(value: string | null | undefined): string {
    return (value ?? '').trim().toUpperCase();
  }

  private normalizeDateOnly(value: string | null | undefined): string | null {
    const input = (value ?? '').trim();
    const match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;

    const dateOnly = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== dateOnly
    ) {
      return null;
    }

    return dateOnly;
  }

  private lastDayOfMonth(dateOnly: string): string {
    const year = Number(dateOnly.slice(0, 4));
    const month = Number(dateOnly.slice(5, 7));
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }
}
