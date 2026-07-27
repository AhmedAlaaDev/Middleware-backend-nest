import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/cash-out-freight-entry.processor';
import { CashOutExchangeRateService } from '@/modules/cash/services/cash-out-exchange-rate.service';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('BaseCashEntryProcessor - task 2047 D365 exchange rates', () => {
  const utilsService = new EntryProcessorUtilsService();
  const dimensionService = new DimensionValidationService();

  const createProcessor = (rates: unknown[]) => {
    const d365ExchangeRateService = {
      getExchangeRatesForCurrencyRange: jest.fn().mockResolvedValue(rates),
    };
    const cashOutExchangeRateService = new CashOutExchangeRateService(
      d365ExchangeRateService as never,
    );
    const processor = new CashOutFreightEntryProcessor(
      { execute: jest.fn() } as never,
      {
        queryBus: { execute: jest.fn() },
        exchangeRateService: {},
        utilsService,
        dimensionService,
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService: {},
        cashOutExchangeRateService,
      } as never,
    );

    (processor as any).company = 'm-p';
    (processor as any).vendorNameMap = new Map();
    jest
      .spyOn(processor as any, 'fetchExchangeRates')
      .mockImplementation(() => {
        throw new Error('legacy exchange-rate lookup must not run');
      });

    return { cashOutExchangeRateService, d365ExchangeRateService, processor };
  };

  const buildGroup = (
    currency: string,
    transactionDate: string,
    excelRate: number,
  ) =>
    [
      {
        UniqueId: 2047,
        LINENUMBER: 1,
        TRANSDATE: transactionDate,
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'V-2047',
        DEFAULTDIMENSIONDISPLAYVALUE:
          '|1402|014|001|005||||6011||5036|5036|Payable|||EXPORT||||',
        DEBITAMOUNT: 100,
        CREDITAMOUNT: 0,
        CURRENCYCODE: currency,
        EXCHANGERATE: excelRate,
        EXCHANGERATESECONDARY: excelRate,
        SafeType: 'Vendor Payment',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 2047,
        LINENUMBER: 2,
        TRANSDATE: transactionDate,
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'BANK-2047',
        CREDITAMOUNT: 100,
        DEBITAMOUNT: 0,
        CURRENCYCODE: currency,
        EXCHANGERATE: excelRate,
        EXCHANGERATESECONDARY: excelRate,
        SafeType: 'Vendor Payment',
        VoucherType: 'Cash',
      },
    ].map((line) => new CashEntryRawDataModel(line as never, 'Freight'));

  it('uses the official D365 rate for balance and journal creation, never Excel', async () => {
    const { cashOutExchangeRateService, processor } = createProcessor([
      {
        RateTypeName: 'Default',
        FromCurrency: 'USD',
        ToCurrency: 'EGP',
        StartDate: '2026-03-01T12:00:00Z',
        EndDate: '2026-03-31T12:00:00Z',
        Rate: 48.75,
      },
    ]);
    const group = buildGroup('USD', '2026-03-20', 999999);
    const context = await cashOutExchangeRateService.load('m-p', group);

    const unbalanced = (processor as any).checkInvoiceBalancedAfterFx(
      new Map([['2047', group]]),
      context,
    );
    const [line] = (processor as any).buildLines('2047', group, context);

    expect(unbalanced).toEqual(new Set());
    expect(line.ExchRate).toBe(4875);
    expect(line.ReportingCurrencyExchRate).toBe(100);
    expect(line.TransactionDate).toBe('2026-03-20');
    expect(line.GetErrors()).not.toEqual(
      expect.arrayContaining([expect.stringContaining('ExchangeRate')]),
    );
  });

  it('adds a specific line validation and avoids fallback/unbalanced noise when no period matches', async () => {
    const { cashOutExchangeRateService, processor } = createProcessor([]);
    const group = buildGroup('USD', '2026-03-20', 48.75);
    const context = await cashOutExchangeRateService.load('m-p', group);

    const unbalanced = (processor as any).checkInvoiceBalancedAfterFx(
      new Map([['2047', group]]),
      context,
    );
    const [line] = (processor as any).buildLines('2047', group, context);

    expect(unbalanced).toEqual(new Set());
    expect(line.ExchRate).toBe(0);
    expect(line.GetErrors()).toContain(
      'ExchangeRate: No valid exchange rate found for USD on 2026-03-20',
    );
    expect(line.GetErrors()).not.toContain(
      'UnbalancedInvoice: Invoice is unbalanced after FX',
    );
  });

  it('bypasses D365 transaction exchange rate for EGP and assigns EGP->USD reporting rate', async () => {
    const { cashOutExchangeRateService, d365ExchangeRateService, processor } =
      createProcessor([
        {
          RateTypeName: 'Default',
          FromCurrency: 'EGP',
          ToCurrency: 'USD',
          StartDate: '2026-03-01T12:00:00Z',
          EndDate: '2026-03-31T12:00:00Z',
          Rate: 0.02,
        },
      ]);
    const group = buildGroup('EGP', '2026-03-20', 100);
    const context = await cashOutExchangeRateService.load('m-p', group);

    const [line] = (processor as any).buildLines('2047', group, context);

    expect(
      d365ExchangeRateService.getExchangeRatesForCurrencyRange,
    ).toHaveBeenCalledWith('m-p', {
      rateType: 'Default',
      fromCurrency: 'EGP',
      toCurrency: 'USD',
      startDate: '2026-03-20',
      endDate: '2026-03-31',
      useCache: false,
    });
    expect(line.ExchRate).toBe(100);
    expect(line.ReportingCurrencyExchRate).toBe(2);
    expect(line.GetErrors()).not.toEqual(
      expect.arrayContaining([expect.stringContaining('ExchangeRate')]),
    );
  });
});
