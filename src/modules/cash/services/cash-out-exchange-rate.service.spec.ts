import { CashOutExchangeRateService } from './cash-out-exchange-rate.service';

import { EntryRawDataModel } from '@/modules/entry-processor/models';

describe('CashOutExchangeRateService', () => {
  const rawLine = (
    transDate: string,
    currencyCode: string,
    sourceExchangeRate = 999999,
  ): EntryRawDataModel =>
    new EntryRawDataModel({
      TRANSDATE: transDate,
      CURRENCYCODE: currencyCode,
      EXCHANGERATE: sourceExchangeRate,
    });

  const d365Rate = (
    fromCurrency: string,
    startDate: string,
    endDate: string,
    rate: number,
  ) => ({
    RateTypeName: 'Default',
    FromCurrency: fromCurrency,
    ToCurrency: 'EGP',
    StartDate: startDate,
    EndDate: endDate,
    Rate: rate,
  });

  const setup = () => {
    const d365ExchangeRateService = {
      getExchangeRatesForCurrencyRange: jest.fn(),
    };
    const service = new CashOutExchangeRateService(
      d365ExchangeRateService as never,
    );

    return { d365ExchangeRateService, service };
  };

  it('uses one file-global date range and makes one request per normalized foreign currency', async () => {
    const { d365ExchangeRateService, service } = setup();
    d365ExchangeRateService.getExchangeRatesForCurrencyRange.mockImplementation(
      (_company: string, options: { fromCurrency: string; toCurrency?: string }) => {
        if (options.toCurrency === 'USD') {
          return Promise.resolve([
            {
              RateTypeName: 'Default',
              FromCurrency: options.fromCurrency,
              ToCurrency: 'USD',
              StartDate: '2026-01-01T12:00:00Z',
              EndDate: '2026-02-28T12:00:00Z',
              Rate: options.fromCurrency === 'EGP' ? 0.02 : 1.1,
            },
          ]);
        }
        return Promise.resolve([
          d365Rate(
            options.fromCurrency,
            '2026-01-01T12:00:00Z',
            '2026-02-28T12:00:00Z',
            options.fromCurrency === 'USD' ? 48.75 : 52.25,
          ),
        ]);
      },
    );

    const context = await service.load('m-p', [
      // EGP rows still participate in the global file range but do not cause
      // an exchange-rate request.
      rawLine('2026-01-01', 'EGP'),
      rawLine('2026-01-10', ' usd '),
      rawLine('2026-01-20', 'USD'),
      rawLine('2026-02-02', 'eur'),
      rawLine('2026-02-03', 'EGP'),
    ]);

    expect(
      d365ExchangeRateService.getExchangeRatesForCurrencyRange,
    ).toHaveBeenCalledWith('m-p', {
      rateType: 'Default',
      fromCurrency: 'USD',
      toCurrency: 'EGP',
      startDate: '2026-01-01',
      endDate: '2026-02-28',
      useCache: false,
    });
    expect(
      d365ExchangeRateService.getExchangeRatesForCurrencyRange,
    ).toHaveBeenCalledWith('m-p', {
      rateType: 'Default',
      fromCurrency: 'EUR',
      toCurrency: 'EGP',
      startDate: '2026-01-01',
      endDate: '2026-02-28',
      useCache: false,
    });
    expect(
      d365ExchangeRateService.getExchangeRatesForCurrencyRange,
    ).toHaveBeenCalledWith('m-p', {
      rateType: 'Default',
      fromCurrency: 'EGP',
      toCurrency: 'USD',
      startDate: '2026-01-01',
      endDate: '2026-02-28',
      useCache: false,
    });

    // The official D365 rate wins over the deliberately poisoned Excel value,
    // using the journal's percentage-rate convention (48.75 -> 4875).
    expect(service.resolve(context, '2026-01-10', ' usd ')).toEqual({
      kind: 'matched',
      rate: 4875,
    });
    expect(service.resolve(context, '2026-02-02', 'EUR')).toEqual({
      kind: 'matched',
      rate: 5225,
    });

    expect(service.resolveReporting(context, '2026-01-10', 'USD')).toEqual({
      kind: 'not-required',
      rate: 100,
    });
    expect(service.resolveReporting(context, '2026-01-01', 'EGP')).toEqual({
      kind: 'matched',
      rate: 2,
    });
  });

  it('does not request or assign an exchange rate for EGP transaction rate', async () => {
    const { d365ExchangeRateService, service } = setup();

    const context = await service.load('m-p', [
      rawLine('2026-03-15', ' egp ', 100),
    ]);

    expect(service.resolve(context, '2026-03-15', 'egp')).toEqual({
      kind: 'not-required',
      rate: 100,
    });
  });

  it('does not request exchange rates for an empty file', async () => {
    const { d365ExchangeRateService, service } = setup();

    await service.load('m-p', []);

    expect(
      d365ExchangeRateService.getExchangeRatesForCurrencyRange,
    ).not.toHaveBeenCalled();
  });

  it('matches validity boundaries by inclusive calendar date, not timestamp', async () => {
    const { d365ExchangeRateService, service } = setup();
    d365ExchangeRateService.getExchangeRatesForCurrencyRange.mockResolvedValue([
      d365Rate('USD', '2026-03-01T12:00:00Z', '2026-03-31T12:00:00Z', 48.75),
    ]);

    const context = await service.load('m-p', [
      rawLine('2026-03-01', 'USD'),
      rawLine('2026-03-31', 'USD'),
    ]);

    expect(service.resolve(context, '2026-03-01', 'USD')).toEqual({
      kind: 'matched',
      rate: 4875,
    });
    expect(service.resolve(context, '2026-03-31', 'USD')).toEqual({
      kind: 'matched',
      rate: 4875,
    });
  });

  it('returns a date-and-currency-specific missing result instead of falling back to 100', async () => {
    const { d365ExchangeRateService, service } = setup();
    d365ExchangeRateService.getExchangeRatesForCurrencyRange.mockResolvedValue([
      d365Rate('USD', '2026-03-01T12:00:00Z', '2026-03-10T12:00:00Z', 48.75),
    ]);

    const context = await service.load('m-p', [rawLine('2026-03-20', 'USD')]);

    expect(service.resolve(context, '2026-03-20', 'USD')).toEqual({
      kind: 'missing',
      rate: 0,
      message: 'No valid exchange rate found for USD on 2026-03-20',
    });
    expect(service.resolveReporting(context, '2026-03-20', 'EGP')).toEqual({
      kind: 'missing',
      rate: 0,
      message: 'No valid reporting exchange rate found for EGP to USD on 2026-03-20',
    });
  });
});
