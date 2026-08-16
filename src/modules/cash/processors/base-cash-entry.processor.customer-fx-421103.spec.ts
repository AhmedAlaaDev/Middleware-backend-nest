import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  extractCashInMainAccount,
  isCashInLedger421103Line,
  parseCashInCustomerInvoices,
} from '@/modules/cash/processors/cash-in-customer-fx.rules';
import { CashInFreightEntryProcessor } from '@/modules/cash/processors/cash-in-freight-entry.processor';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/cash-out-freight-entry.processor';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('Cash-In customer FX + Ledger 421103', () => {
  const utilsService = new EntryProcessorUtilsService();

  const createCashInProcessor = () => {
    const processor = new CashInFreightEntryProcessor(
      { execute: jest.fn() } as any,
      {
        queryBus: { execute: jest.fn() },
        exchangeRateService: {},
        utilsService,
        dimensionService: new DimensionValidationService(),
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService: {},
        cashOutExchangeRateService: {},
        generalJournalService: {},
      } as any,
    );
    (processor as any).company = 'm-p';
    (processor as any).dimensionsMap = new Map();
    (processor as any).accountNumberSet = new Set();
    (processor as any).customerNameMap = new Map([
      ['101000543', 'Customer 543'],
    ]);
    jest
      .spyOn(processor as any, 'validateDimensionsForLine')
      .mockImplementation(() => undefined);
    jest.spyOn(processor as any, 'fetchExchangeRates').mockReturnValue({
      exchangeRate: 4765,
      reportingRate: 100,
    });
    return processor;
  };

  const createCashOutProcessor = () => {
    const processor = new CashOutFreightEntryProcessor(
      { execute: jest.fn() } as any,
      {
        queryBus: { execute: jest.fn() },
        exchangeRateService: {},
        utilsService,
        dimensionService: new DimensionValidationService(),
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService: {},
        cashOutExchangeRateService: {},
        generalJournalService: {},
      } as any,
    );
    (processor as any).company = 'm-p';
    return processor;
  };

  const toModels = (lines: Array<Record<string, unknown>>, inbound = true) =>
    lines.map(
      (line) => new CashEntryRawDataModel(line as any, 'Freight', inbound),
    );

  const exampleGroup = () =>
    toModels([
      {
        UniqueId: 466669,
        LINENUMBER: 67,
        VOUCHER: 'CashIn-000125199',
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Petty Cash',
        ACCOUNTDISPLAYVALUE: 'ALEXHO US',
        DEBITAMOUNT: 730,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        EXCHANGERATE: 4765,
        INVOICE: '5564/مطالبة نولون محصلة لصالح الغير',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 466669,
        LINENUMBER: 68,
        VOUCHER: 'CashIn-000125199',
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Petty Cash',
        ACCOUNTDISPLAYVALUE: 'ALEXHO EG',
        DEBITAMOUNT: 360,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        EXCHANGERATE: 100,
        INVOICE: '5564/مطالبة نولون محصلة لصالح الغير',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 466669,
        LINENUMBER: 69,
        VOUCHER: 'CashIn-000125199',
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: '101000543',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 737,
        CURRENCYCODE: 'USD',
        EXCHANGERATE: 4765,
        INVOICE: '5564/مطالبة نولون محصلة لصالح الغير',
        DEFAULTDIMENSIONDISPLAYVALUE:
          '|1301|013|001|001|101000543||||||||Payable|||IMPORT||||',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 466669,
        LINENUMBER: 70,
        VOUCHER: 'CashIn-000125199',
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE:
          '421103|1301|013|001|001|101000543|||||KEYACCOUNT|3336||||IMPORT||||',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 26.45,
        CURRENCYCODE: 'EGP',
        EXCHANGERATE: 100,
        INVOICE: '5564/مطالبة نولون محصلة لصالح الغير',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
    ]);

  it('matches USD debit to customer and keeps Ledger 421103 as a normal source line', async () => {
    const processor = createCashInProcessor();
    const source = exampleGroup();

    const processed = await (
      processor as any
    ).applyCashInCustomerForeignCurrencyRules(source);

    expect(processed).toHaveLength(4);
    expect(
      processed.some((line: CashEntryRawDataModel) =>
        isCashInLedger421103Line(line),
      ),
    ).toBe(true);

    const customer = processed.find(
      (line: CashEntryRawDataModel) => line.LINENUMBER === 69,
    );
    expect(customer.DEBITAMOUNT).toBe(0);
    expect(customer.CREDITAMOUNT).toBe(730);
    expect(customer.CURRENCYCODE).toBe('USD');
    expect(customer.INVOICE).toBe('5564/مطالبة نولون محصلة لصالح الغير');

    const built = (processor as any).buildLines('466669', processed);
    expect(built).toHaveLength(4);

    const customerLine = built.find(
      (line: any) => line.CreditAmount === 730 && line.CurrencyCode === 'USD',
    );
    expect(customerLine).toBeDefined();
    expect(customerLine.AccountDisplayValue).toBe('101000543');
    expect(customerLine.MarkedLines).toEqual([
      expect.objectContaining({ InvoiceNumber: '000005564/OF-FW' }),
    ]);
    expect(
      built.every(
        (line: any) =>
          line.OffsetAccountType === '' &&
          line.OffsetAccountDisplayValue === '',
      ),
    ).toBe(true);
    expect(
      built.map((line: any) => ({
        account: line.AccountDisplayValue,
        debit: line.DebitAmount,
        credit: line.CreditAmount,
      })),
    ).toEqual([
      { account: 'ALEXHO US', debit: 730, credit: 0 },
      { account: 'ALEXHO EG', debit: 360, credit: 0 },
      { account: '101000543', debit: 0, credit: 730 },
      {
        account:
          '421103|1301|013|001|001|101000543|||||KEYACCOUNT|3336||||IMPORT||||',
        debit: 0,
        credit: 26.45,
      },
    ]);
  });

  it('uniquely matches Notes Receivable debit when customer FX amount equals 122201', async () => {
    const processor = createCashInProcessor();
    const lines = toModels([
      {
        UniqueId: 468971,
        LINENUMBER: 2017,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Petty Cash',
        ACCOUNTDISPLAYVALUE: 'ALEXHO EG',
        DEBITAMOUNT: 75.5,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        EXCHANGERATE: 100,
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 468971,
        LINENUMBER: 2018,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE:
          '122201|1301|013|001|001|||RP-000001|RP-000001||3038|3208||||IMPORT||||',
        DEBITAMOUNT: 6194.5,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        EXCHANGERATE: 100,
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 468971,
        LINENUMBER: 2019,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: '101000046',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 130,
        CURRENCYCODE: 'USD',
        EXCHANGERATE: 4765,
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 468971,
        LINENUMBER: 2020,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE:
          '421103|1301|013|001|001|101000046|||||3038|3208||||IMPORT||||',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 75.5,
        CURRENCYCODE: 'EGP',
        EXCHANGERATE: 100,
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
    ]);

    const processed = await (
      processor as any
    ).applyCashInCustomerForeignCurrencyRules(lines);
    const customer = processed.find(
      (line: CashEntryRawDataModel) => line.LINENUMBER === 2019,
    );

    expect(customer.CREDITAMOUNT).toBe(6194.5);
    expect(customer.CURRENCYCODE).toBe('EGP');
    expect(
      processed.some((line: CashEntryRawDataModel) =>
        isCashInLedger421103Line(line),
      ),
    ).toBe(true);

    const built = (processor as any).buildLines('468971', processed);
    expect(built.every((line: any) => line.ErrorCount === 0)).toBe(true);
  });

  it('skips FX rewrite for same-currency groups that already balance', async () => {
    const processor = createCashInProcessor();
    const lines = toModels([
      {
        UniqueId: 473668,
        LINENUMBER: 4648,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Petty Cash',
        ACCOUNTDISPLAYVALUE: 'ALEXHO EG',
        DEBITAMOUNT: 100000,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        EXCHANGERATE: 100,
        SafeType: 'Customer Collection',
        VoucherType: 'Deposit',
      },
      {
        UniqueId: 473668,
        LINENUMBER: 4649,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'CIB-EG-CA',
        DEBITAMOUNT: 53870,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        EXCHANGERATE: 100,
        SafeType: 'Customer Collection',
        VoucherType: 'Deposit',
      },
      {
        UniqueId: 473668,
        LINENUMBER: 4650,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: '101001506',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 153870.06,
        CURRENCYCODE: 'EGP',
        EXCHANGERATE: 100,
        SafeType: 'Customer Collection',
        VoucherType: 'Deposit',
      },
      {
        UniqueId: 473668,
        LINENUMBER: 4651,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE:
          '421103|1302|013|001|001|101001506|||||3042|3336||||IMPORT||||',
        DEBITAMOUNT: 0.06,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        EXCHANGERATE: 100,
        SafeType: 'Customer Collection',
        VoucherType: 'Deposit',
      },
    ]);

    const processed = await (
      processor as any
    ).applyCashInCustomerForeignCurrencyRules(lines);

    expect(processed).toHaveLength(4);
    expect(processed.find((l: any) => l.LINENUMBER === 4650).CREDITAMOUNT).toBe(
      153870.06,
    );
    expect(
      (processor as any).cashInCustomerFxResults.has('473668'),
    ).toBe(false);
  });

  it('assigns multiple customers to multiple debits one-to-one by currency', async () => {
    const processor = createCashInProcessor();
    const lines = toModels([
      {
        UniqueId: 100,
        LINENUMBER: 1,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'BANK-USD',
        DEBITAMOUNT: 100,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        INVOICE: 'INV-A',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 100,
        LINENUMBER: 2,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'BANK-EUR',
        DEBITAMOUNT: 200,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EUR',
        INVOICE: 'INV-B',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 100,
        LINENUMBER: 3,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'C-USD',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 111,
        CURRENCYCODE: 'USD',
        INVOICE: 'INV-A',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 100,
        LINENUMBER: 4,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'C-EUR',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 222,
        CURRENCYCODE: 'EUR',
        INVOICE: 'INV-B',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 100,
        LINENUMBER: 5,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '421103|001',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 1,
        CURRENCYCODE: 'EGP',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
    ]);

    const processed = await (
      processor as any
    ).applyCashInCustomerForeignCurrencyRules(lines);
    const usdCust = processed.find(
      (line: CashEntryRawDataModel) => line.LINENUMBER === 3,
    );
    const eurCust = processed.find(
      (line: CashEntryRawDataModel) => line.LINENUMBER === 4,
    );

    expect(usdCust.CREDITAMOUNT).toBe(100);
    expect(usdCust.CURRENCYCODE).toBe('USD');
    expect(eurCust.CREDITAMOUNT).toBe(200);
    expect(eurCust.CURRENCYCODE).toBe('EUR');

    const built = (processor as any).buildLines('100', processed);
    expect(built).toHaveLength(5);
    expect(
      built.map((line: any) => ({
        credit: line.CreditAmount,
        currency: line.CurrencyCode,
        account: line.AccountDisplayValue,
      })),
    ).toEqual(
      expect.arrayContaining([
        { credit: 0, currency: 'USD', account: 'BANK-USD' },
        { credit: 0, currency: 'EUR', account: 'BANK-EUR' },
        { credit: 100, currency: 'USD', account: 'C-USD' },
        { credit: 200, currency: 'EUR', account: 'C-EUR' },
        { credit: 1, currency: 'EGP', account: '421103|001' },
      ]),
    );
    expect(
      built.every((line: any) => line.OffsetAccountDisplayValue === ''),
    ).toBe(true);
  });

  it('does not refresh exchange rate when currency already matches', async () => {
    const processor = createCashInProcessor();
    const fetchSpy = jest.spyOn(processor as any, 'fetchExchangeRates');
    fetchSpy.mockClear();

    const lines = toModels([
      {
        UniqueId: 200,
        LINENUMBER: 1,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Petty Cash',
        ACCOUNTDISPLAYVALUE: 'SAFE',
        DEBITAMOUNT: 50,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        EXCHANGERATE: 4765,
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 200,
        LINENUMBER: 2,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'C1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 60,
        CURRENCYCODE: 'USD',
        EXCHANGERATE: 4765,
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 200,
        LINENUMBER: 3,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '421103|x',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 1,
        CURRENCYCODE: 'EGP',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
    ]);

    await (processor as any).applyCashInCustomerForeignCurrencyRules(lines);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lines[1].CREDITAMOUNT).toBe(50);
    expect(lines[1].EXCHANGERATE).toBe(4765);
  });

  it('refreshes exchange rate when customer currency differs from debit', async () => {
    const processor = createCashInProcessor();
    const fetchSpy = jest
      .spyOn(processor as any, 'fetchExchangeRates')
      .mockReturnValue({ exchangeRate: 9999, reportingRate: 100 });

    const lines = toModels([
      {
        UniqueId: 201,
        LINENUMBER: 1,
        TRANSDATE: '2026-02-01',
        ACCOUNTTYPE: 'Petty Cash',
        ACCOUNTDISPLAYVALUE: 'SAFE',
        DEBITAMOUNT: 702,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 201,
        LINENUMBER: 2,
        TRANSDATE: '2026-02-01',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'C1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 600,
        CURRENCYCODE: 'EUR',
        EXCHANGERATE: 1111,
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 201,
        LINENUMBER: 3,
        TRANSDATE: '2026-02-01',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '421103|x',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 1,
        CURRENCYCODE: 'EGP',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
    ]);

    await (processor as any).applyCashInCustomerForeignCurrencyRules(lines);

    expect(fetchSpy).toHaveBeenCalledWith('2026-02-01', 'USD');
    expect(lines[1].CREDITAMOUNT).toBe(702);
    expect(lines[1].CURRENCYCODE).toBe('USD');
    expect(lines[1].EXCHANGERATE).toBe(9999);
  });

  it('blocks the full UniqueId when exchange rate is missing after currency change', async () => {
    const processor = createCashInProcessor();
    jest
      .spyOn(processor as any, 'fetchExchangeRates')
      .mockImplementation(() => {
        throw new Error('missing rate');
      });

    const lines = toModels([
      {
        UniqueId: 202,
        LINENUMBER: 1,
        TRANSDATE: '2026-02-01',
        ACCOUNTTYPE: 'Petty Cash',
        ACCOUNTDISPLAYVALUE: 'SAFE',
        DEBITAMOUNT: 702,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 202,
        LINENUMBER: 2,
        TRANSDATE: '2026-02-01',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'C1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 600,
        CURRENCYCODE: 'EUR',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 202,
        LINENUMBER: 3,
        TRANSDATE: '2026-02-01',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '421103|x',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 1,
        CURRENCYCODE: 'EGP',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
    ]);

    const processed = await (
      processor as any
    ).applyCashInCustomerForeignCurrencyRules(lines);
    // Invalid groups keep source lines; build emits only the validation error.
    expect(processed).toHaveLength(3);
    expect(lines[1].CREDITAMOUNT).toBe(600);
    expect(lines[1].CURRENCYCODE).toBe('EUR');

    const built = (processor as any).buildLines('202', processed);
    expect(built).toHaveLength(1);
    expect(built[0].ErrorCount).toBeGreaterThan(0);
    expect(
      built[0]
        .GetErrors()
        .some((error: string) =>
          error.includes('Unable to determine a unique debit line'),
        ),
    ).toBe(true);
  });

  it('detects Ledger lines only when AccountType is Ledger and main account is exactly 421103', () => {
    expect(
      isCashInLedger421103Line(
        toModels([
          {
            ACCOUNTTYPE: 'Ledger',
            ACCOUNTDISPLAYVALUE: '421103|1301|013',
          },
        ])[0],
      ),
    ).toBe(true);

    expect(
      isCashInLedger421103Line(
        toModels([
          {
            ACCOUNTTYPE: ' ledger ',
            ACCOUNTDISPLAYVALUE: '421103|1301|013',
          },
        ])[0],
      ),
    ).toBe(true);

    expect(
      isCashInLedger421103Line(
        toModels([
          {
            ACCOUNTTYPE: 'LEDGER',
            ACCOUNTDISPLAYVALUE: '421103',
          },
        ])[0],
      ),
    ).toBe(true);

    expect(
      isCashInLedger421103Line(
        toModels([
          {
            ACCOUNTTYPE: 'Ledger',
            ACCOUNTDISPLAYVALUE: '421103-001-002',
          },
        ])[0],
      ),
    ).toBe(true);

    expect(
      isCashInLedger421103Line(
        toModels([
          {
            ACCOUNTTYPE: 'Ledger',
            ACCOUNTDISPLAYVALUE: '223304|1301|013',
          },
        ])[0],
      ),
    ).toBe(false);

    expect(
      isCashInLedger421103Line(
        toModels([
          {
            ACCOUNTTYPE: 'Ledger',
            ACCOUNTDISPLAYVALUE: '4211039|1301|013',
          },
        ])[0],
      ),
    ).toBe(false);

    expect(
      isCashInLedger421103Line(
        toModels([
          {
            ACCOUNTTYPE: 'Ledger',
            ACCOUNTDISPLAYVALUE: '1421103',
          },
        ])[0],
      ),
    ).toBe(false);

    expect(
      isCashInLedger421103Line(
        toModels([
          {
            ACCOUNTTYPE: 'Ledger',
            ACCOUNTDISPLAYVALUE: '42110',
          },
        ])[0],
      ),
    ).toBe(false);

    expect(
      isCashInLedger421103Line(
        toModels([
          {
            ACCOUNTTYPE: 'Cust',
            ACCOUNTDISPLAYVALUE: '421103',
          },
        ])[0],
      ),
    ).toBe(false);

    expect(
      isCashInLedger421103Line(
        toModels([
          {
            ACCOUNTTYPE: 'Vend',
            ACCOUNTDISPLAYVALUE: '421103',
          },
        ])[0],
      ),
    ).toBe(false);

    expect(
      isCashInLedger421103Line(
        toModels([
          {
            ACCOUNTTYPE: 'Bank',
            ACCOUNTDISPLAYVALUE: '421103',
          },
        ])[0],
      ),
    ).toBe(false);

    expect(
      isCashInLedger421103Line(
        toModels([
          {
            ACCOUNTTYPE: 'Ledger',
            ACCOUNTDISPLAYVALUE: '223304|1301|421103|001',
          },
        ])[0],
      ),
    ).toBe(false);

    expect(extractCashInMainAccount('223304|1301|421103|001')).toBe('223304');
    expect(extractCashInMainAccount('421103-001-002')).toBe('421103');
  });

  it('matches EUR customer to Notes Receivable when Petty Cash + 122201 remain after excluding 421103', async () => {
    const processor = createCashInProcessor();
    jest.spyOn(processor as any, 'fetchExchangeRates').mockImplementation(
      (_date: string, currencyCode: string) => {
        const currency = String(currencyCode ?? '')
          .trim()
          .toUpperCase();
        if (currency === 'EUR') {
          return { exchangeRate: 5580, reportingRate: 100 };
        }
        if (currency === 'USD') {
          return { exchangeRate: 4765, reportingRate: 100 };
        }
        return { exchangeRate: 100, reportingRate: 100 };
      },
    );

    const lines = toModels([
      {
        UniqueId: 469310,
        LINENUMBER: 2315,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Petty Cash',
        ACCOUNTDISPLAYVALUE: 'ALEXHO EG',
        DEBITAMOUNT: 18.1,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        EXCHANGERATE: 100,
        SafeType: 'Customer Collection',
        VoucherType: 'Cheque',
      },
      {
        UniqueId: 469310,
        LINENUMBER: 2316,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE:
          '122201|1301|013|001|001|||RP-000001|RP-000001||3038|3208||||IMPORT||||',
        DEBITAMOUNT: 911.9,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        EXCHANGERATE: 100,
        SafeType: 'Customer Collection',
        VoucherType: 'Cheque',
      },
      {
        UniqueId: 469310,
        LINENUMBER: 2317,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: '101000046',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 16.55,
        CURRENCYCODE: 'EUR',
        EXCHANGERATE: 5580,
        SafeType: 'Customer Collection',
        VoucherType: 'Cheque',
      },
      {
        UniqueId: 469310,
        LINENUMBER: 2318,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE:
          '421103|1301|013|001|001|101000046|||||3038|3208||||IMPORT||||',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 6.51,
        CURRENCYCODE: 'EGP',
        EXCHANGERATE: 100,
        SafeType: 'Customer Collection',
        VoucherType: 'Cheque',
      },
    ]);

    const processed = await (
      processor as any
    ).applyCashInCustomerForeignCurrencyRules(lines);

    expect(
      processed.some((line: CashEntryRawDataModel) =>
        isCashInLedger421103Line(line),
      ),
    ).toBe(true);

    const customer = processed.find(
      (line: CashEntryRawDataModel) => line.LINENUMBER === 2317,
    );
    expect(customer.CREDITAMOUNT).toBe(911.9);
    expect(customer.CURRENCYCODE).toBe('EGP');

    const built = (processor as any).buildLines('469310', processed);
    expect(built.every((line: any) => line.ErrorCount === 0)).toBe(true);
    expect(
      built.some((line: any) =>
        String(line.AccountDisplayValue ?? '').startsWith('421103'),
      ),
    ).toBe(true);
  });

  it('posts Ledger 421103 as a normal Cash-In source line with empty offsets', async () => {
    const processor = createCashInProcessor();
    const source = exampleGroup();
    const processed = await (
      processor as any
    ).applyCashInCustomerForeignCurrencyRules(source);
    const built = (processor as any).buildLines('466669', processed);

    expect(
      processed.some((line: CashEntryRawDataModel) =>
        isCashInLedger421103Line(line),
      ),
    ).toBe(true);
    for (const line of built) {
      expect(line.OffsetAccountType || '').toBe('');
      expect(line.OffsetAccountDisplayValue || '').toBe('');
    }
  });

  it('parses comma-separated customer invoices without mutating INVOICE or splitting amount', async () => {
    const processor = createCashInProcessor();
    const lines = toModels([
      {
        UniqueId: 300,
        LINENUMBER: 1,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'BANK',
        DEBITAMOUNT: 730,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        INVOICE: 'INV-1001',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 300,
        LINENUMBER: 2,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'C1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 800,
        CURRENCYCODE: 'USD',
        INVOICE: 'INV-1001, INV-1002,INV-1003,',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 300,
        LINENUMBER: 3,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '421103|x',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 1,
        CURRENCYCODE: 'EGP',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
    ]);

    expect(parseCashInCustomerInvoices(lines[1])).toEqual([
      'INV-1001',
      'INV-1002',
      'INV-1003',
    ]);

    await (processor as any).applyCashInCustomerForeignCurrencyRules(lines);
    expect(lines[1].INVOICE).toBe('INV-1001, INV-1002,INV-1003,');
    expect(lines[1].CREDITAMOUNT).toBe(730);

    const marked = (processor as any).formatInvoiceInbound(lines[1].INVOICE);
    // Existing FTI path still uses the primary token only.
    expect(
      marked.startsWith('000INV') || marked.includes('1001') || marked === '',
    ).toBe(true);
  });

  it('does not apply customer multi-invoice parsing to non-Cust lines', () => {
    const bankLine = toModels([
      {
        ACCOUNTTYPE: 'Bank',
        INVOICE: 'INV-1, INV-2',
      },
    ])[0];

    expect(parseCashInCustomerInvoices(bankLine)).toEqual([]);
  });

  it('fails the UniqueId on ambiguous debit/customer assignment', async () => {
    const processor = createCashInProcessor();
    const lines = toModels([
      {
        UniqueId: 400,
        LINENUMBER: 1,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'B1',
        DEBITAMOUNT: 100,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        INVOICE: 'SAME',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 400,
        LINENUMBER: 2,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'B2',
        DEBITAMOUNT: 200,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        INVOICE: 'SAME',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 400,
        LINENUMBER: 3,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'C1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 150,
        CURRENCYCODE: 'USD',
        INVOICE: 'SAME',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 400,
        LINENUMBER: 4,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '421103|x',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 1,
        CURRENCYCODE: 'EGP',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
    ]);

    const processed = await (
      processor as any
    ).applyCashInCustomerForeignCurrencyRules(lines);
    const built = (processor as any).buildLines('400', processed);

    expect(built).toHaveLength(1);
    expect(built[0].ErrorCount).toBeGreaterThan(0);
    expect(lines[2].CREDITAMOUNT).toBe(150);
  });

  it('fails the UniqueId when a customer has no matching debit', async () => {
    const processor = createCashInProcessor();
    const lines = toModels([
      {
        UniqueId: 401,
        LINENUMBER: 1,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'B1',
        DEBITAMOUNT: 100,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 401,
        LINENUMBER: 2,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'C1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 100,
        CURRENCYCODE: 'USD',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 401,
        LINENUMBER: 3,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'C2',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 50,
        CURRENCYCODE: 'EUR',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 401,
        LINENUMBER: 4,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '421103|x',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 1,
        CURRENCYCODE: 'EGP',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
    ]);

    const processed = await (
      processor as any
    ).applyCashInCustomerForeignCurrencyRules(lines);
    const built = (processor as any).buildLines('401', processed);
    expect(built).toHaveLength(1);
    expect(built[0].ErrorCount).toBeGreaterThan(0);
  });

  it('does not enter Cash-In FX matching for same-currency groups even when Ledger 421103 exists', async () => {
    const processor = createCashInProcessor();
    const lines = toModels([
      {
        UniqueId: 402,
        LINENUMBER: 1,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'B1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 402,
        LINENUMBER: 2,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'C1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 100,
        CURRENCYCODE: 'USD',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 402,
        LINENUMBER: 3,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '421103|x',
        DEBITAMOUNT: 5,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
    ]);

    const processed = await (
      processor as any
    ).applyCashInCustomerForeignCurrencyRules(lines);
    expect(processed).toHaveLength(3);
    expect((processor as any).cashInCustomerFxResults.has('402')).toBe(false);
    expect(
      processed.some((line: CashEntryRawDataModel) =>
        isCashInLedger421103Line(line),
      ),
    ).toBe(true);
    expect(processed[1].CREDITAMOUNT).toBe(100);
  });

  it('does not apply the special transform when Ledger 421103 is absent', async () => {
    const processor = createCashInProcessor();
    const lines = toModels([
      {
        UniqueId: 500,
        LINENUMBER: 1,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Petty Cash',
        ACCOUNTDISPLAYVALUE: 'SAFE',
        DEBITAMOUNT: 730,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'USD',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 500,
        LINENUMBER: 2,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'C1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 737,
        CURRENCYCODE: 'USD',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
    ]);

    const processed = await (
      processor as any
    ).applyCashInCustomerForeignCurrencyRules(lines);
    expect(processed).toHaveLength(2);
    expect(processed[1].CREDITAMOUNT).toBe(737);
    expect((processor as any).cashInCustomerFxResults.has('500')).toBe(false);

    const built = (processor as any).buildLines('500', processed);
    expect(built).toHaveLength(2);
    expect(built[0].DebitAmount).toBe(730);
    expect(built[1].CreditAmount).toBe(737);
    expect(
      built.every((line: any) => line.OffsetAccountDisplayValue === ''),
    ).toBe(true);
  });

  it('does not apply Cash-In special rules on Cash-Out processors', async () => {
    const processor = createCashOutProcessor();
    const lines = exampleGroup().map(
      (line) =>
        new CashEntryRawDataModel(
          {
            ...line,
            SafeType: 'Vendor Payment',
          } as any,
          'Freight',
          false,
        ),
    );

    const before = lines.map((line) => ({
      credit: line.CREDITAMOUNT,
      currency: line.CURRENCYCODE,
      line: line.LINENUMBER,
    }));

    const processed = await (
      processor as any
    ).applyCashInCustomerForeignCurrencyRules(lines);

    expect(processed).toHaveLength(4);
    expect(
      processed.map((line: CashEntryRawDataModel) => ({
        credit: line.CREDITAMOUNT,
        currency: line.CURRENCYCODE,
        line: line.LINENUMBER,
      })),
    ).toEqual(before);
    expect((processor as any).cashInCustomerFxResults.size).toBe(0);
  });
});
