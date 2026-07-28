import { Injectable } from '@nestjs/common';

import { ExchangeRateService as D365FOExchangeRateService } from '@/modules/d365fo/services/exchange-rate.service';
import { D365FOExchangeRate } from '@/modules/d365fo/types';
import { EntryRawDataModel } from '@/modules/entry-processor/models';

export interface CashOutExchangeRateContext {
  earliestTransactionDate: string | null;
  latestTransactionDate: string | null;
  requestStartDate: string | null;
  requestEndDate: string | null;
  ratesByCurrency: ReadonlyMap<string, readonly D365FOExchangeRate[]>;
  reverseRatesByCurrency: ReadonlyMap<string, readonly D365FOExchangeRate[]>;
  reportingRatesByCurrency: ReadonlyMap<string, readonly D365FOExchangeRate[]>;
  reverseReportingRatesByCurrency: ReadonlyMap<
    string,
    readonly D365FOExchangeRate[]
  >;
}

export type CashOutExchangeRateResolution =
  | { kind: 'matched'; rate: number }
  | { kind: 'not-required'; rate: number }
  | { kind: 'missing'; rate: 0; message: string };

/**
 * Task 2047 & 2048 exchange-rate loader and in-memory matcher for Cash files.
 * Supports direct and reverse (reciprocal) exchange-rate lookups for both
 * transaction rates (Currency <-> EGP) and reporting rates (Currency <-> USD).
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
    const requestStartDate = earliestTransactionDate
      ? this.firstDayOfMonth(earliestTransactionDate)
      : null;
    const latestTransactionDate =
      transactionDates[transactionDates.length - 1] ?? null;
    const requestEndDate = latestTransactionDate
      ? this.lastDayOfMonth(latestTransactionDate)
      : null;

    const foreignCurrencies = [
      ...new Set(
        lines
          .map((line) =>
            this.normalizeCurrency(
              line.CURRENCYCODE || CashOutExchangeRateService.BASE_CURRENCY,
            ),
          )
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
          .map((line) =>
            this.normalizeCurrency(
              line.CURRENCYCODE || CashOutExchangeRateService.BASE_CURRENCY,
            ),
          )
          .filter(
            (currency) =>
              Boolean(currency) &&
              currency !== CashOutExchangeRateService.REPORTING_CURRENCY,
          ),
      ),
    ].sort();

    const ratesByCurrency = new Map<string, readonly D365FOExchangeRate[]>();
    const reverseRatesByCurrency = new Map<
      string,
      readonly D365FOExchangeRate[]
    >();
    const reportingRatesByCurrency = new Map<
      string,
      readonly D365FOExchangeRate[]
    >();
    const reverseReportingRatesByCurrency = new Map<
      string,
      readonly D365FOExchangeRate[]
    >();

    if (requestStartDate && requestEndDate) {
      const [
        directResults,
        reverseResults,
        directReportingResults,
        reverseReportingResults,
      ] = await Promise.all([
        // Direct transaction rates: Currency -> EGP
        Promise.all(
          foreignCurrencies.map(async (fromCurrency) => {
            const rates =
              await this.d365ExchangeRateService.getExchangeRatesForCurrencyRange(
                company,
                {
                  rateType: CashOutExchangeRateService.RATE_TYPE,
                  fromCurrency,
                  toCurrency: CashOutExchangeRateService.BASE_CURRENCY,
                  startDate: requestStartDate,
                  endDate: requestEndDate,
                  useCache: false,
                },
              );

            return [fromCurrency, Object.freeze([...(rates || [])])] as const;
          }),
        ),
        // Reverse transaction rates: EGP -> Currency
        Promise.all(
          foreignCurrencies.map(async (toCurrency) => {
            const rates =
              await this.d365ExchangeRateService.getExchangeRatesForCurrencyRange(
                company,
                {
                  rateType: CashOutExchangeRateService.RATE_TYPE,
                  fromCurrency: CashOutExchangeRateService.BASE_CURRENCY,
                  toCurrency,
                  startDate: requestStartDate,
                  endDate: requestEndDate,
                  useCache: false,
                },
              );

            return [toCurrency, Object.freeze([...(rates || [])])] as const;
          }),
        ),
        // Direct reporting rates: Currency -> USD
        Promise.all(
          nonUsdCurrencies.map(async (fromCurrency) => {
            const rates =
              await this.d365ExchangeRateService.getExchangeRatesForCurrencyRange(
                company,
                {
                  rateType: CashOutExchangeRateService.RATE_TYPE,
                  fromCurrency,
                  toCurrency: CashOutExchangeRateService.REPORTING_CURRENCY,
                  startDate: requestStartDate,
                  endDate: requestEndDate,
                  useCache: false,
                },
              );

            return [fromCurrency, Object.freeze([...(rates || [])])] as const;
          }),
        ),
        // Reverse reporting rates: USD -> Currency
        Promise.all(
          nonUsdCurrencies.map(async (toCurrency) => {
            const rates =
              await this.d365ExchangeRateService.getExchangeRatesForCurrencyRange(
                company,
                {
                  rateType: CashOutExchangeRateService.RATE_TYPE,
                  fromCurrency: CashOutExchangeRateService.REPORTING_CURRENCY,
                  toCurrency,
                  startDate: requestStartDate,
                  endDate: requestEndDate,
                  useCache: false,
                },
              );

            return [toCurrency, Object.freeze([...(rates || [])])] as const;
          }),
        ),
      ]);

      for (const [currency, rates] of directResults) {
        ratesByCurrency.set(currency, rates);
      }
      for (const [currency, rates] of reverseResults) {
        reverseRatesByCurrency.set(currency, rates);
      }
      for (const [currency, rates] of directReportingResults) {
        reportingRatesByCurrency.set(currency, rates);
      }
      for (const [currency, rates] of reverseReportingResults) {
        reverseReportingRatesByCurrency.set(currency, rates);
      }
    }

    return {
      earliestTransactionDate,
      latestTransactionDate,
      requestStartDate,
      requestEndDate,
      ratesByCurrency,
      reverseRatesByCurrency,
      reportingRatesByCurrency,
      reverseReportingRatesByCurrency,
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

    // 1. Attempt direct retrieval: Currency -> EGP
    const directRates = context.ratesByCurrency.get(currency) ?? [];
    const directSelected = this.matchPeriodRate(
      directRates,
      currency,
      CashOutExchangeRateService.BASE_CURRENCY,
      date,
    );

    if (directSelected) {
      return { kind: 'matched', rate: Number(directSelected.rate * 100) };
    }

    // 2. Fallback to reverse lookup: EGP -> Currency and calculate reciprocal
    const reverseRates = context.reverseRatesByCurrency.get(currency) ?? [];
    const reverseSelected = this.matchPeriodRate(
      reverseRates,
      CashOutExchangeRateService.BASE_CURRENCY,
      currency,
      date,
    );

    if (reverseSelected) {
      const reciprocal = 1 / reverseSelected.rate;
      return { kind: 'matched', rate: Number(reciprocal * 100) };
    }

    // 3. Neither direction configured -> validation error
    return this.missing(currency, date);
  }

  public resolveReporting(
    context: CashOutExchangeRateContext,
    transactionDate: string,
    currencyCode: string,
  ): CashOutExchangeRateResolution {
    const currency = this.normalizeCurrency(currencyCode);
    const date = this.normalizeDateOnly(transactionDate);

    // Rule: Currency is USD -> set value to 1
    if (currency === CashOutExchangeRateService.REPORTING_CURRENCY) {
      return { kind: 'not-required', rate: 1 };
    }

    if (!currency || !date) {
      return this.missingReporting(
        currency || '(empty)',
        date || '(invalid date)',
      );
    }

    // 1. Attempt direct retrieval: Currency -> USD (e.g. GBP -> USD = 1.34, EUR -> USD = 1.18)
    const directRates = context.reportingRatesByCurrency.get(currency) ?? [];
    const directSelected = this.matchPeriodRate(
      directRates,
      currency,
      CashOutExchangeRateService.REPORTING_CURRENCY,
      date,
    );

    if (directSelected) {
      return { kind: 'matched', rate: Number(directSelected.rate) };
    }

    // 2. Fallback to reverse lookup: USD -> Currency (e.g. USD -> EGP = 47.65 => EGP -> USD = 1 / 47.65)
    const reverseRates =
      context.reverseReportingRatesByCurrency.get(currency) ?? [];
    const reverseSelected = this.matchPeriodRate(
      reverseRates,
      CashOutExchangeRateService.REPORTING_CURRENCY,
      currency,
      date,
    );

    if (reverseSelected) {
      const reciprocal = 1 / reverseSelected.rate;
      return { kind: 'matched', rate: Number(reciprocal) };
    }

    // 3. Neither direction configured -> validation error
    return this.missingReporting(currency, date);
  }

  private matchPeriodRate(
    rates: readonly D365FOExchangeRate[],
    fromCurrency: string,
    toCurrency: string,
    targetDate: string,
  ): { startDate: string; rate: number } | null {
    let selected: { startDate: string; rate: number } | null = null;

    for (const rate of rates) {
      if (
        this.normalizeCurrency(rate.FromCurrency) !== fromCurrency ||
        this.normalizeCurrency(rate.ToCurrency) !== toCurrency ||
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
        targetDate < startDate ||
        targetDate > endDate
      ) {
        continue;
      }

      if (!selected || startDate > selected.startDate) {
        selected = { startDate, rate: numericRate };
      }
    }

    return selected;
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

  private normalizeDateOnly(value: unknown): string | null {
    if (value === null || value === undefined) return null;

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return value.toISOString().slice(0, 10);
    }

    const input = String(value).trim();
    if (!input) return null;

    // Standard ISO YYYY-MM-DD or YYYY/MM/DD
    const isoMatch = input.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
    if (isoMatch) {
      const dateOnly = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
      const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
      if (!Number.isNaN(parsed.getTime())) {
        return dateOnly;
      }
    }

    // Slash format DD/MM/YYYY or MM/DD/YYYY (e.g. 05/01/2026)
    const slashMatch = input.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (slashMatch) {
      const p1 = Number(slashMatch[1]);
      const p2 = Number(slashMatch[2]);
      const year = slashMatch[3];
      let month = p1;
      let day = p2;
      if (p1 > 12) {
        day = p1;
        month = p2;
      }
      const mm = String(month).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      return `${year}-${mm}-${dd}`;
    }

    // General Date parsing fallback
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }

    // Excel numeric serial date fallback (e.g. 46027)
    const numeric = Number(input);
    if (Number.isFinite(numeric) && numeric > 25000 && numeric < 75000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const dateFromExcel = new Date(
        excelEpoch.getTime() + numeric * 86400000,
      );
      if (!Number.isNaN(dateFromExcel.getTime())) {
        return dateFromExcel.toISOString().slice(0, 10);
      }
    }

    return null;
  }

  private firstDayOfMonth(dateOnly: string): string {
    return `${dateOnly.slice(0, 7)}-01`;
  }

  private lastDayOfMonth(dateOnly: string): string {
    const year = Number(dateOnly.slice(0, 4));
    const month = Number(dateOnly.slice(5, 7));
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }
}
