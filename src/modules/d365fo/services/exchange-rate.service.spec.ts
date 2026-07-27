import { ExchangeRateService } from './exchange-rate.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

describe('D365FO ExchangeRateService - currency range', () => {
  it('sends one overlap query with the exact currency pair and date window', async () => {
    const d365foClient = {
      get: jest.fn().mockResolvedValue({
        value: [
          {
            RateTypeName: 'Default',
            FromCurrency: 'USD',
            ToCurrency: 'EGP',
            StartDate: '2026-02-01T12:00:00Z',
            EndDate: '2026-02-28T12:00:00Z',
            Rate: 47.2,
          },
        ],
      }),
    };
    const service = new ExchangeRateService(
      d365foClient as never,
      new ODataQueryBuilderService(),
    );

    const result = await service.getExchangeRatesForCurrencyRange('m-p', {
      rateType: 'Default',
      fromCurrency: ' usd ',
      toCurrency: 'egp',
      startDate: '2026-02-01',
      endDate: '2026-07-31',
      useCache: false,
    });

    expect(result).toHaveLength(1);
    expect(d365foClient.get).toHaveBeenCalledTimes(1);

    const [encodedEndpoint, requestOptions] = d365foClient.get.mock.calls[0];
    const endpoint = decodeURIComponent(encodedEndpoint);

    expect(endpoint).toContain('/data/ExchangeRates?');
    expect(endpoint).toContain("RateTypeName eq 'Default'");
    expect(endpoint).toContain("FromCurrency eq 'USD'");
    expect(endpoint).toContain("ToCurrency eq 'EGP'");
    expect(endpoint).toContain('EndDate ge 2026-02-01T00:00:00.000Z');
    expect(endpoint).toContain('StartDate le 2026-07-31T23:59:59.999Z');
    expect(endpoint).toContain('$top=10000');
    expect(endpoint).toContain('$orderby=StartDate asc');
    expect(requestOptions).toMatchObject({ useCache: false });
  });

  it('rejects invalid calendar bounds before calling D365', async () => {
    const d365foClient = { get: jest.fn() };
    const service = new ExchangeRateService(
      d365foClient as never,
      new ODataQueryBuilderService(),
    );

    await expect(
      service.getExchangeRatesForCurrencyRange('m-p', {
        fromCurrency: 'USD',
        toCurrency: 'EGP',
        startDate: '2026-02-30',
        endDate: '2026-07-31',
      }),
    ).rejects.toThrow('Invalid exchange-rate range date: 2026-02-30');
    expect(d365foClient.get).not.toHaveBeenCalled();
  });
});
