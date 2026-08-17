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

describe('Cash-In customer FX + Ledger 421103 Exclusion', () => {
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
      ['101000046', 'Customer 046'],
      ['101003837', 'Customer 837'],
      ['101000585', 'Customer 585'],
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
    jest.spyOn(processor as any, 'fetchExchangeRates').mockReturnValue({
      exchangeRate: 100,
      reportingRate: 100,
    });
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

  describe('Explicit Acceptance Criteria (AC1 - AC12)', () => {
    it('AC1: excludes Ledger + 421103 from Cash-In journal line generation', async () => {
      const processor = createCashInProcessor();
      const source = exampleGroup();

      const processed = await (
        processor as any
      ).applyCashInCustomerForeignCurrencyRules(source);

      expect(processed).toHaveLength(3);
      expect(
        processed.some((line: CashEntryRawDataModel) =>
          isCashInLedger421103Line(line),
        ),
      ).toBe(false);

      const built = (processor as any).buildLines('466669', processed);
      expect(built).toHaveLength(3);
      expect(
        built.some((line: any) =>
          String(line.AccountDisplayValue ?? '').startsWith('421103'),
        ),
      ).toBe(false);
    });

    it('AC2: requires both AccountType = Ledger AND AccountDisplayValue = 421103', async () => {
      const processor = createCashInProcessor();

      // Case A: Ledger with account 421104 -> not excluded
      const linesA = toModels([
        {
          UniqueId: 101,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-01',
          DEBITAMOUNT: 100,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 101,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421104|1301|013|001',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 100,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
      ]);
      const processedA = await (
        processor as any
      ).applyCashInCustomerForeignCurrencyRules(linesA);
      expect(processedA).toHaveLength(2);
      expect(processedA[1].ACCOUNTDISPLAYVALUE).toBe('421104|1301|013|001');

      // Case B: Cust with account 421103 -> not excluded
      const linesB = toModels([
        {
          UniqueId: 102,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-01',
          DEBITAMOUNT: 100,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 102,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Cust',
          ACCOUNTDISPLAYVALUE: '421103',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 100,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
      ]);
      const processedB = await (
        processor as any
      ).applyCashInCustomerForeignCurrencyRules(linesB);
      expect(processedB).toHaveLength(2);
      expect(processedB[1].ACCOUNTDISPLAYVALUE).toBe('421103');
    });

    it('AC3: handles lowercase and whitespace in AccountType ("ledger", " LEDGER ", " Ledger ")', () => {
      const lineLower = toModels([
        { ACCOUNTTYPE: 'ledger', ACCOUNTDISPLAYVALUE: '421103' },
      ])[0];
      const lineUpper = toModels([
        { ACCOUNTTYPE: ' LEDGER ', ACCOUNTDISPLAYVALUE: '421103' },
      ])[0];
      const lineMixed = toModels([
        { ACCOUNTTYPE: ' Ledger ', ACCOUNTDISPLAYVALUE: '421103' },
      ])[0];

      expect(isCashInLedger421103Line(lineLower)).toBe(true);
      expect(isCashInLedger421103Line(lineUpper)).toBe(true);
      expect(isCashInLedger421103Line(lineMixed)).toBe(true);
    });

    it('AC4: trims account number with surrounding spaces (" 421103 ")', () => {
      const lineSpaces = toModels([
        { ACCOUNTTYPE: 'Ledger', ACCOUNTDISPLAYVALUE: '  421103  ' },
      ])[0];
      expect(isCashInLedger421103Line(lineSpaces)).toBe(true);
    });

    it('AC5: Ledger account other than 421103 is not excluded', () => {
      const otherLedger = toModels([
        { ACCOUNTTYPE: 'Ledger', ACCOUNTDISPLAYVALUE: '223304' },
        { ACCOUNTTYPE: 'Ledger', ACCOUNTDISPLAYVALUE: '421104' },
        { ACCOUNTTYPE: 'Ledger', ACCOUNTDISPLAYVALUE: '122201' },
      ]);
      for (const line of otherLedger) {
        expect(isCashInLedger421103Line(line)).toBe(false);
      }
    });

    it('AC6: Non-Ledger account with display value 421103 is not excluded', () => {
      const nonLedgers = toModels([
        { ACCOUNTTYPE: 'Cust', ACCOUNTDISPLAYVALUE: '421103' },
        { ACCOUNTTYPE: 'Vend', ACCOUNTDISPLAYVALUE: '421103' },
        { ACCOUNTTYPE: 'Bank', ACCOUNTDISPLAYVALUE: '421103' },
        { ACCOUNTTYPE: 'Petty Cash', ACCOUNTDISPLAYVALUE: '421103' },
      ]);
      for (const line of nonLedgers) {
        expect(isCashInLedger421103Line(line)).toBe(false);
      }
    });

    it('AC7: Excluded 421103 is not selected for customer matching', async () => {
      const processor = createCashInProcessor();
      const lines = toModels([
        {
          UniqueId: 301,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Petty Cash',
          ACCOUNTDISPLAYVALUE: 'SAFE-USD',
          DEBITAMOUNT: 500,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'USD',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 301,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103',
          DEBITAMOUNT: 500,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'USD',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 301,
          LINENUMBER: 3,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Cust',
          ACCOUNTDISPLAYVALUE: '101000543',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 450,
          CURRENCYCODE: 'EUR',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
      ]);

      const processed = await (
        processor as any
      ).applyCashInCustomerForeignCurrencyRules(lines);

      // 421103 was excluded; customer was uniquely matched to Petty Cash SAFE-USD
      expect(processed).toHaveLength(2);
      const customer = processed.find((l: any) => l.LINENUMBER === 3);
      expect(customer.CREDITAMOUNT).toBe(500);
      expect(customer.CURRENCYCODE).toBe('USD');
      expect((customer as any).__cashInFxTransform.sourceDebitLineNumber).toBe(
        1,
      );
    });

    it('AC8: Excluded 421103 does not re-enter a fallback Cash-In case', async () => {
      const processor = createCashInProcessor();
      const source = exampleGroup();

      const processed = await (
        processor as any
      ).applyCashInCustomerForeignCurrencyRules(source);
      const built = (processor as any).buildLines('466669', processed);

      expect(built).toHaveLength(3);
      for (const line of built) {
        expect(line.AccountDisplayValue).not.toContain('421103');
        expect(line.OffsetAccountDisplayValue).not.toContain('421103');
      }
    });

    it('AC9: Multiple 421103 lines are handled consistently', async () => {
      const processor = createCashInProcessor();
      const lines = toModels([
        {
          UniqueId: 302,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Petty Cash',
          ACCOUNTDISPLAYVALUE: 'SAFE-USD',
          DEBITAMOUNT: 100,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'USD',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 302,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Cust',
          ACCOUNTDISPLAYVALUE: '101000543',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 100,
          CURRENCYCODE: 'USD',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 302,
          LINENUMBER: 3,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103|1101',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 10,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 302,
          LINENUMBER: 4,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103|1102',
          DEBITAMOUNT: 5,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
      ]);

      const processed = await (
        processor as any
      ).applyCashInCustomerForeignCurrencyRules(lines);
      expect(processed).toHaveLength(2);
      expect(
        processed.some((line: CashEntryRawDataModel) =>
          isCashInLedger421103Line(line),
        ),
      ).toBe(false);
    });

    it('AC10: Mixed UniqueId groups are processed independently', async () => {
      const processor = createCashInProcessor();
      const group1 = toModels([
        {
          UniqueId: 1001,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-1',
          DEBITAMOUNT: 200,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'USD',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 1001,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Cust',
          ACCOUNTDISPLAYVALUE: 'C1',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 200,
          CURRENCYCODE: 'USD',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 1001,
          LINENUMBER: 3,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 5,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
      ]);
      const group2 = toModels([
        {
          UniqueId: 1002,
          LINENUMBER: 4,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-2',
          DEBITAMOUNT: 300,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 1002,
          LINENUMBER: 5,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Cust',
          ACCOUNTDISPLAYVALUE: 'C2',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 300,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
      ]);

      const processed = await (
        processor as any
      ).applyCashInCustomerForeignCurrencyRules([...group1, ...group2]);

      // Group 1001 has 2 lines (421103 excluded), Group 1002 has 2 lines (unchanged)
      expect(processed).toHaveLength(4);
      expect(processed.filter((l: any) => l.UniqueId === 1001)).toHaveLength(2);
      expect(processed.filter((l: any) => l.UniqueId === 1002)).toHaveLength(2);
    });

    it('AC11: Custody Settlement with Ledger 421103 retains the line and routes to Cash-Out', async () => {
      const cashInProcessor = createCashInProcessor();
      const lines = toModels([
        {
          UniqueId: 2001,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: '4080',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 500,
          CURRENCYCODE: 'EGP',
          SafeType: 'Custody Settlement',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 2001,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '421103',
          DEBITAMOUNT: 500,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          SafeType: 'Custody Settlement',
          VoucherType: 'Cash',
        },
      ]);

      // SafeType Custody Settlement routes out of Cash-In completely
      const routed = await (
        cashInProcessor as any
      ).routeCashInCustodySettlementToCashOut(lines);
      expect(routed).toHaveLength(0);

      // In Cash-Out processor, the 421103 line is preserved
      const cashOutProcessor = createCashOutProcessor();
      const cashOutLines = lines.map(
        (l) =>
          new CashEntryRawDataModel(
            { ...l, SafeType: 'Custody Settlement' } as any,
            'Freight',
            false,
          ),
      );
      const built = (cashOutProcessor as any).buildLines(
        '2001',
        cashOutLines,
      );
      expect(built).toHaveLength(2);
      expect(
        built.some((l: any) => l.AccountDisplayValue === '421103'),
      ).toBe(true);
    });

    it('AC12: Existing Cash-In transactions without 421103 produce unchanged results', async () => {
      const processor = createCashInProcessor();
      const lines = toModels([
        {
          UniqueId: 3001,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Petty Cash',
          ACCOUNTDISPLAYVALUE: 'SAFE-1',
          DEBITAMOUNT: 1000,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 3001,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Cust',
          ACCOUNTDISPLAYVALUE: 'C-001',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 1000,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
      ]);

      const processed = await (
        processor as any
      ).applyCashInCustomerForeignCurrencyRules(lines);
      expect(processed).toHaveLength(2);
      const built = (processor as any).buildLines('3001', processed);
      expect(built).toHaveLength(2);
      expect(built[0].DebitAmount).toBe(1000);
      expect(built[1].CreditAmount).toBe(1000);
    });
  });

  describe('Real-world Multi-Currency & Notes Receivable Scenarios', () => {
    it('matches USD debit to customer and excludes Ledger 421103', async () => {
      const processor = createCashInProcessor();
      const source = exampleGroup();

      const processed = await (
        processor as any
      ).applyCashInCustomerForeignCurrencyRules(source);

      expect(processed).toHaveLength(3);
      expect(
        processed.some((line: CashEntryRawDataModel) =>
          isCashInLedger421103Line(line),
        ),
      ).toBe(false);

      const customer = processed.find(
        (line: CashEntryRawDataModel) => line.LINENUMBER === 69,
      );
      expect(customer.DEBITAMOUNT).toBe(0);
      expect(customer.CREDITAMOUNT).toBe(730);
      expect(customer.CURRENCYCODE).toBe('USD');
      expect(customer.INVOICE).toBe('5564/مطالبة نولون محصلة لصالح الغير');

      const built = (processor as any).buildLines('466669', processed);
      expect(built).toHaveLength(3);

      const customerLine = built.find(
        (line: any) => line.CreditAmount === 730 && line.CurrencyCode === 'USD',
      );
      expect(customerLine).toBeDefined();
      expect(customerLine.AccountDisplayValue).toBe('101000543');
      expect(customerLine.MarkedLines).toEqual([
        expect.objectContaining({ InvoiceNumber: '000005564/OF-FW' }),
      ]);
    });

    it('uniquely matches Notes Receivable debit when customer FX amount equals 122201 and excludes 421103', async () => {
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
      expect(processed).toHaveLength(3);

      const customer = processed.find(
        (line: CashEntryRawDataModel) => line.LINENUMBER === 2019,
      );
      expect(customer.CREDITAMOUNT).toBe(6194.5);
      expect(customer.CURRENCYCODE).toBe('EGP');

      const built = (processor as any).buildLines('468971', processed);
      expect(built).toHaveLength(3);
      expect(built.every((line: any) => line.ErrorCount === 0)).toBe(true);
    });

    it('matches EUR customer to Petty Cash USD and excludes Ledger 421103 (466693)', async () => {
      const processor = createCashInProcessor();
      jest.spyOn(processor as any, 'fetchExchangeRates').mockImplementation(
        (_date: string, currencyCode: string) => {
          const currency = String(currencyCode ?? '')
            .trim()
            .toUpperCase();
          if (currency === 'USD') {
            return { exchangeRate: 4765, reportingRate: 100 };
          }
          if (currency === 'EUR') {
            return { exchangeRate: 5580, reportingRate: 100 };
          }
          return { exchangeRate: 100, reportingRate: 100 };
        },
      );

      const lines = toModels([
        {
          UniqueId: 466693,
          LINENUMBER: 137,
          VOUCHER: 'CashIn-000125223',
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Petty Cash',
          ACCOUNTDISPLAYVALUE: 'ALEXHO US',
          DEBITAMOUNT: 702,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'USD',
          EXCHANGERATE: 4765,
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 466693,
          LINENUMBER: 138,
          VOUCHER: 'CashIn-000125223',
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Cust',
          ACCOUNTDISPLAYVALUE: '101003837',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 600,
          CURRENCYCODE: 'EUR',
          EXCHANGERATE: 5580,
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 466693,
          LINENUMBER: 139,
          VOUCHER: 'CashIn-000125223',
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE:
            '421103|1301|013|001|001|101003837|||||3038|3208||||IMPORT||||',
          DEBITAMOUNT: 29.7,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          EXCHANGERATE: 100,
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        },
      ]);

      const processed = await (
        processor as any
      ).applyCashInCustomerForeignCurrencyRules(lines);
      expect(processed).toHaveLength(2);

      const customer = processed.find(
        (line: CashEntryRawDataModel) => line.LINENUMBER === 138,
      );
      expect(customer.CREDITAMOUNT).toBe(702);
      expect(customer.CURRENCYCODE).toBe('USD');

      const built = (processor as any).buildLines('466693', processed);
      expect(built).toHaveLength(2);
      expect(built.every((line: any) => line.ErrorCount === 0)).toBe(true);
    });

    it('matches EUR customer to Bank USD and excludes Ledger 421103 (470802)', async () => {
      const processor = createCashInProcessor();
      jest.spyOn(processor as any, 'fetchExchangeRates').mockImplementation(
        (_date: string, currencyCode: string) => {
          const currency = String(currencyCode ?? '')
            .trim()
            .toUpperCase();
          if (currency === 'USD') {
            return { exchangeRate: 4765, reportingRate: 100 };
          }
          if (currency === 'EUR') {
            return { exchangeRate: 5580, reportingRate: 100 };
          }
          return { exchangeRate: 100, reportingRate: 100 };
        },
      );

      const lines = toModels([
        {
          UniqueId: 470802,
          LINENUMBER: 3184,
          VOUCHER: 'BankIn-000128771',
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-US',
          DEBITAMOUNT: 385,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'USD',
          EXCHANGERATE: 4765,
          SafeType: 'Customer Collection',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 470802,
          LINENUMBER: 3185,
          VOUCHER: 'BankIn-000128771',
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Cust',
          ACCOUNTDISPLAYVALUE: '101000585',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 330,
          CURRENCYCODE: 'EUR',
          EXCHANGERATE: 5580,
          SafeType: 'Customer Collection',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 470802,
          LINENUMBER: 3186,
          VOUCHER: 'BankIn-000128771',
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE:
            '421103|1301|013|001|001|101000585|||||3038|3208||||IMPORT||||',
          DEBITAMOUNT: 68.75,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          EXCHANGERATE: 100,
          SafeType: 'Customer Collection',
          VoucherType: 'Transfer',
        },
      ]);

      const processed = await (
        processor as any
      ).applyCashInCustomerForeignCurrencyRules(lines);
      expect(processed).toHaveLength(2);

      const customer = processed.find(
        (line: CashEntryRawDataModel) => line.LINENUMBER === 3185,
      );
      expect(customer.CREDITAMOUNT).toBe(385);
      expect(customer.CURRENCYCODE).toBe('USD');

      const built = (processor as any).buildLines('470802', processed);
      expect(built).toHaveLength(2);
      expect(built.every((line: any) => line.ErrorCount === 0)).toBe(true);
    });
  });
});
