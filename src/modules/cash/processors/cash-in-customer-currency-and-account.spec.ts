import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashInFreightEntryProcessor } from '@/modules/cash/processors/inbound/freight/cash-in-freight-entry.processor';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('Cash-In: customer currency alignment and 125901/125902 account classification', () => {
  const utilsService = new EntryProcessorUtilsService();
  const dimensionService = new DimensionValidationService();

  const createProcessor = () => {
    const processor = new CashInFreightEntryProcessor(
      { execute: jest.fn() } as any,
      {
        queryBus: { execute: jest.fn() },
        exchangeRateService: {},
        utilsService,
        dimensionService,
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService: {},
      } as any,
    );

    (processor as any).company = 'm-p';
    (processor as any).customerNameMap = new Map();
    jest.spyOn(processor as any, 'fetchExchangeRates').mockReturnValue({
      exchangeRate: 1,
      reportingRate: 1,
    });

    return processor;
  };

  const customerLine = (overrides: Partial<CashEntryRawDataModel> = {}) =>
    new CashEntryRawDataModel(
      {
        UniqueId: 1,
        LINENUMBER: 1,
        VOUCHER: 'CashIn-000001',
        TRANSDATE: '2026-01-01',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'Customer-001',
        DEFAULTDIMENSIONDISPLAYVALUE:
          '|1301|013|001|001|101000046||||||||||IMPORT||||',
        CREDITAMOUNT: 100,
        DEBITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
        ...overrides,
      } as any,
      'Freight',
      true,
    );

  const ledgerLine = (overrides: Partial<CashEntryRawDataModel> = {}) =>
    new CashEntryRawDataModel(
      {
        UniqueId: 1,
        LINENUMBER: 2,
        VOUCHER: 'CashIn-000001',
        TRANSDATE: '2026-01-01',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE:
          '421103|1301|013|001|001|101000046||||||||||IMPORT||||',
        CREDITAMOUNT: 0,
        DEBITAMOUNT: 100,
        CURRENCYCODE: 'USD',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
        ...overrides,
      } as any,
      'Freight',
      true,
    );

  // --- Part 1: Customer currency alignment -------------------------------

  it('1. Customer EGP + Ledger USD -> Customer becomes USD', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [
      customerLine({ CURRENCYCODE: 'EGP' }),
      ledgerLine({ CURRENCYCODE: 'USD' }),
    ]);

    expect(line.CurrencyCode).toBe('USD');
    expect(line.GetErrors()).toEqual([]);
  });

  it('2. Customer USD + Ledger USD -> remains USD', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [
      customerLine({ CURRENCYCODE: 'USD' }),
      ledgerLine({ CURRENCYCODE: 'USD' }),
    ]);

    expect(line.CurrencyCode).toBe('USD');
  });

  it('3. Customer USD + Ledger EUR -> Customer becomes EUR', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [
      customerLine({ CURRENCYCODE: 'USD' }),
      ledgerLine({ CURRENCYCODE: 'EUR' }),
    ]);

    expect(line.CurrencyCode).toBe('EUR');
  });

  it('4. Multiple non-customer lines -> correct paired line selected (settlement filtered, remaining offset wins)', () => {
    const processor = createProcessor();
    const bankLine = new CashEntryRawDataModel(
      {
        UniqueId: 1,
        LINENUMBER: 3,
        VOUCHER: 'CashIn-000001',
        TRANSDATE: '2026-01-01',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'POS-EG',
        CREDITAMOUNT: 0,
        DEBITAMOUNT: 100,
        CURRENCYCODE: 'EGP',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      } as any,
      'Freight',
      true,
    );

    const [line] = (processor as any).buildLines('1', [
      customerLine({ CURRENCYCODE: 'USD' }),
      ledgerLine({ CURRENCYCODE: 'EGP' }),
      bankLine,
    ]);

    // The 421103 settlement line is filtered out; the remaining Bank offset
    // line is the correctly paired non-customer line and its currency wins.
    expect(line.CurrencyCode).toBe('EGP');
    expect(line.OffsetAccountType).toBe('Bank');
    expect(line.OffsetAccountDisplayValue).toBe('POS-EG');
  });

  it('5. Missing corresponding non-customer line -> clear validation failure', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [customerLine()]);

    expect(line.GetErrors()).toContain(
      'InvalidMapping: Unable to determine the corresponding non-customer line for the customer transaction.',
    );
  });

  it('13. Custody Settlement lines never reach the Cash-In currency rule', () => {
    const processor = createProcessor();
    const custodyLine = customerLine({
      SafeType: 'Custody Settlement',
      CURRENCYCODE: 'EGP',
    } as any);
    const custodyOffset = ledgerLine({
      SafeType: 'Custody Settlement',
      CURRENCYCODE: 'USD',
    } as any);

    const { custodySettlementLines, otherLines } = jest
      .requireActual('@/modules/cash/policies/cash-batch.policy')
      .classifyCashLines([custodyLine, custodyOffset], true);

    expect(custodySettlementLines).toHaveLength(2);
    expect(otherLines).toHaveLength(0);
    void processor;
  });

  it('14. Existing standard Cash-In transactions not using these accounts remain unchanged', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [
      customerLine({
        ACCOUNTDISPLAYVALUE: 'Customer-999',
        CURRENCYCODE: 'EGP',
      }),
      new CashEntryRawDataModel(
        {
          UniqueId: 1,
          LINENUMBER: 2,
          VOUCHER: 'CashIn-000099',
          TRANSDATE: '2026-01-01',
          ACCOUNTTYPE: 'Petty cash',
          ACCOUNTDISPLAYVALUE: 'ALEXHO EG',
          CREDITAMOUNT: 0,
          DEBITAMOUNT: 100,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        } as any,
        'Freight',
        true,
      ),
    ]);

    expect(line.CurrencyCode).toBe('EGP');
    expect(line.AccountType).toBe('Cust');
    expect(line.OffsetAccountType).toBe('Petty cash');
    expect(line.GetErrors()).toEqual([]);
  });

  // --- Part 2: 125901 / 125902 account classification --------------------

  it('6. Account 125901 resolves as Ledger', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [
      customerLine({ CURRENCYCODE: 'USD' }),
      new CashEntryRawDataModel(
        {
          UniqueId: 1,
          LINENUMBER: 2,
          VOUCHER: 'CashIn-000001',
          TRANSDATE: '2026-01-01',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: '125901',
          CREDITAMOUNT: 0,
          DEBITAMOUNT: 100,
          CURRENCYCODE: 'USD',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        } as any,
        'Freight',
        true,
      ),
    ]);

    expect(line.OffsetAccountType).toBe('Ledger');
    expect(line.OffsetAccountDisplayValue).toBe('125901');
  });

  it('7. Account 125902 resolves as Ledger', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [
      customerLine({ CURRENCYCODE: 'EUR' }),
      new CashEntryRawDataModel(
        {
          UniqueId: 1,
          LINENUMBER: 2,
          VOUCHER: 'CashIn-000001',
          TRANSDATE: '2026-01-01',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: '125902',
          CREDITAMOUNT: 0,
          DEBITAMOUNT: 100,
          CURRENCYCODE: 'EUR',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        } as any,
        'Freight',
        true,
      ),
    ]);

    expect(line.OffsetAccountType).toBe('Ledger');
    expect(line.OffsetAccountDisplayValue).toBe('125902');
  });

  it('8/9/10/11. 125901 (USD) and 125902 (EUR) never resolve as Bank and post with Ledger mapping', () => {
    const processor = createProcessor();

    const buildWith = (mainAccount: string, currency: string) =>
      (processor as any).buildLines('1', [
        customerLine({ CURRENCYCODE: currency }),
        new CashEntryRawDataModel(
          {
            UniqueId: 1,
            LINENUMBER: 2,
            VOUCHER: 'CashIn-000001',
            TRANSDATE: '2026-01-01',
            ACCOUNTTYPE: 'Bank',
            ACCOUNTDISPLAYVALUE: mainAccount,
            CREDITAMOUNT: 0,
            DEBITAMOUNT: 100,
            CURRENCYCODE: currency,
            SafeType: 'Customer Collection',
            VoucherType: 'Cash',
          } as any,
          'Freight',
          true,
        ),
      ])[0];

    const usdLine = buildWith('125901', 'USD');
    expect(usdLine.OffsetAccountType).not.toBe('Bank');
    expect(usdLine.OffsetAccountType).toBe('Ledger');
    expect(usdLine.GetErrors()).toEqual([]);

    const eurLine = buildWith('125902', 'EUR');
    expect(eurLine.OffsetAccountType).not.toBe('Bank');
    expect(eurLine.OffsetAccountType).toBe('Ledger');
    expect(eurLine.GetErrors()).toEqual([]);
  });

  it('12. Customer EGP + 125901/USD -> Customer becomes USD and 125901 remains Ledger', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [
      customerLine({ CURRENCYCODE: 'EGP' }),
      new CashEntryRawDataModel(
        {
          UniqueId: 1,
          LINENUMBER: 2,
          VOUCHER: 'CashIn-000001',
          TRANSDATE: '2026-01-01',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: '125901',
          CREDITAMOUNT: 0,
          DEBITAMOUNT: 100,
          CURRENCYCODE: 'USD',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        } as any,
        'Freight',
        true,
      ),
    ]);

    expect(line.CurrencyCode).toBe('USD');
    expect(line.OffsetAccountType).toBe('Ledger');
    expect(line.OffsetAccountDisplayValue).toBe('125901');
    expect(line.GetErrors()).toEqual([]);
  });

  it('16. Clears a BankAccount dimension segment that leaks a Ledger main account (DimAttributeBankAccountTable failure)', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [
      customerLine({ CURRENCYCODE: 'EGP' }),
      ledgerLine({
        CURRENCYCODE: 'EGP',
        // Last dimension segment (bankAccount) leaks the account's own
        // main account value instead of a real BankAccountTable id.
        ACCOUNTDISPLAYVALUE:
          '421103|1301|013|001|001|101000046||||||||||IMPORT||||125901',
      }),
    ]);

    expect(line.DefaultDimensionsForOffsetAccountDisplayValue).not.toContain(
      '125901',
    );
    expect(line.DefaultDimensionsForAccountDisplayValue).not.toContain(
      '125901',
    );
    expect(line.GetErrors()).toEqual([]);
  });

  it('15. The generated payload never represents 125901/125902 as a BankAccountTable value', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [
      customerLine({ CURRENCYCODE: 'USD' }),
      new CashEntryRawDataModel(
        {
          UniqueId: 1,
          LINENUMBER: 2,
          VOUCHER: 'CashIn-000001',
          TRANSDATE: '2026-01-01',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: '125901',
          CREDITAMOUNT: 0,
          DEBITAMOUNT: 100,
          CURRENCYCODE: 'USD',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        } as any,
        'Freight',
        true,
      ),
    ]);

    expect(line.AccountType).not.toBe('Bank');
    expect(line.OffsetAccountType).not.toBe('Bank');
    expect(line.OffsetAccountType).toBe('Ledger');
    expect(line.OffsetAccountDisplayValue).toBe('125901');
    expect(line.CurrencyCode).toBe('USD');
    expect(line.GetErrors()).toEqual([]);
  });
});
