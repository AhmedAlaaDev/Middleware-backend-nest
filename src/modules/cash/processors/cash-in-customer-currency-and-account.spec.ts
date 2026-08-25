import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashIn421103CurrencyPolicy } from '@/modules/cash/policies/cash-in-421103-currency.policy';
import { CashInFreightEntryProcessor } from '@/modules/cash/processors/inbound/freight/cash-in-freight-entry.processor';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('Cash-In: customer account with a source offset line', () => {
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

  const offsetLine = (overrides: Partial<CashEntryRawDataModel> = {}) =>
    new CashEntryRawDataModel(
      {
        UniqueId: 1,
        LINENUMBER: 2,
        VOUCHER: 'CashIn-000001',
        TRANSDATE: '2026-01-01',
        ACCOUNTTYPE: 'Petty cash',
        ACCOUNTDISPLAYVALUE: 'PETTY-001',
        CREDITAMOUNT: 0,
        DEBITAMOUNT: 100,
        CURRENCYCODE: 'EGP',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
        ...overrides,
      } as any,
      'Freight',
      true,
    );

  it('keeps Customer as account and the source cash line as offset', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [
      customerLine(),
      offsetLine(),
    ]);

    expect(line.AccountType).toBe('Cust');
    expect(line.AccountDisplayValue).toBe('Customer-001');
    expect(line.OffsetAccountType).toBe('Petty cash');
    expect(line.OffsetAccountDisplayValue).toBe('PETTY-001');
    expect(line.CreditAmount).toBe(100);
    expect(line.DebitAmount).toBe(0);
  });

  it('uses the offset currency without applying the removed grouping logic', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [
      customerLine({ CURRENCYCODE: 'EGP' }),
      offsetLine({ CURRENCYCODE: 'USD' }),
    ]);

    expect(line.CurrencyCode).toBe('USD');
    expect(line.OffsetAccountDisplayValue).toBe('PETTY-001');
  });

  it('sets PaymentId to UniqueId,source-line-number and preserves the sheet line number', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [
      customerLine({ UniqueId: 536999, LINENUMBER: 21 }),
      offsetLine({ UniqueId: 536999, LINENUMBER: 22 }),
    ]);

    expect(line.PaymentId).toBe('536999,22');
    expect(line.LineNumber).toBe(22);
  });

  it('uses the corresponding customer account for each valid payment line', () => {
    const processor = createProcessor();
    const result = (processor as any).buildLines('1', [
      customerLine({
        ACCOUNTDISPLAYVALUE: 'Customer-001',
        LINENUMBER: 1,
        INVOICE: 'INV-1',
      }),
      customerLine({
        ACCOUNTDISPLAYVALUE: 'Customer-002',
        LINENUMBER: 2,
        CREDITAMOUNT: 50,
        INVOICE: 'INV-2',
      }),
      offsetLine({ LINENUMBER: 3, DEBITAMOUNT: 50, INVOICE: 'INV-2' }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].AccountDisplayValue).toBe('Customer-002');
    expect(result[0].OffsetAccountType).toBe('Petty cash');
  });

  it('creates one customer-account line per currency-bearing payment offset', () => {
    const processor = createProcessor();
    const result = (processor as any).buildLines('1', [
      customerLine({ CREDITAMOUNT: 150, CURRENCYCODE: 'EGP' }),
      offsetLine({
        LINENUMBER: 2,
        ACCOUNTDISPLAYVALUE: 'BANK-USD',
        DEBITAMOUNT: 75,
        CURRENCYCODE: 'USD',
        DEFAULTDIMENSIONDISPLAYVALUE:
          '|2001|020|002|002|999999999||||||||||IMPORT||||',
        FINTAGDISPLAYVALUE: 'BANK-USD-TAG',
      }),
      offsetLine({
        LINENUMBER: 3,
        ACCOUNTDISPLAYVALUE: 'PETTY-EUR',
        DEBITAMOUNT: 75,
        CURRENCYCODE: 'EUR',
        DEFAULTDIMENSIONDISPLAYVALUE:
          '|3001|030|003|003|999999999||||||||||IMPORT||||',
        FINTAGDISPLAYVALUE: 'PETTY-EUR-TAG',
      }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((line: any) => line.AccountDisplayValue)).toEqual([
      'Customer-001',
      'Customer-001',
    ]);
    expect(result.map((line: any) => line.CurrencyCode)).toEqual([
      'USD',
      'EUR',
    ]);
    expect(result.map((line: any) => line.OffsetAccountDisplayValue)).toEqual([
      'BANK-USD',
      'PETTY-EUR',
    ]);
    expect(result.map((line: any) => line.FinTagDisplayValue)).toEqual([
      'BANK-USD-TAG',
      'PETTY-EUR-TAG',
    ]);
  });

  it('uses a unique offset source line for each customer payment with multiple offsets', () => {
    const processor = createProcessor();
    const result = (processor as any).buildLines('1', [
      customerLine({ LINENUMBER: 10, CREDITAMOUNT: 150 }),
      offsetLine({
        LINENUMBER: 11,
        ACCOUNTDISPLAYVALUE: 'BANK-001',
        DEBITAMOUNT: 50,
      }),
      offsetLine({
        LINENUMBER: 12,
        ACCOUNTDISPLAYVALUE: 'PETTY-002',
        DEBITAMOUNT: 100,
      }),
    ]);

    expect(result.map((line: any) => line.PaymentId)).toEqual(['1,11', '1,12']);
    expect(result.map((line: any) => line.LineNumber)).toEqual([11, 12]);
    expect(result.map((line: any) => line.OffsetAccountDisplayValue)).toEqual([
      'BANK-001',
      'PETTY-002',
    ]);
  });

  it('creates one customer-main entry for each payment when repeated customer rows use the same account', () => {
    const processor = createProcessor();
    const result = (processor as any).buildLines('77', [
      customerLine({
        UniqueId: 77,
        LINENUMBER: 1,
        ACCOUNTDISPLAYVALUE: 'Customer-001',
        CREDITAMOUNT: 100,
        INVOICE: 'INV-A',
      }),
      customerLine({
        UniqueId: 77,
        LINENUMBER: 2,
        ACCOUNTDISPLAYVALUE: 'Customer-001',
        CREDITAMOUNT: 50,
        INVOICE: 'INV-B',
      }),
      offsetLine({
        UniqueId: 77,
        LINENUMBER: 3,
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'BANK-001',
        DEBITAMOUNT: 50,
        INVOICE: 'INV-B',
      }),
      offsetLine({
        UniqueId: 77,
        LINENUMBER: 4,
        ACCOUNTDISPLAYVALUE: 'PETTY-002',
        DEBITAMOUNT: 100,
        INVOICE: 'INV-A',
      }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((line: any) => line.AccountDisplayValue)).toEqual([
      'Customer-001',
      'Customer-001',
    ]);
    expect(result.map((line: any) => line.OffsetAccountDisplayValue)).toEqual([
      'BANK-001',
      'PETTY-002',
    ]);
    expect(result.map((line: any) => line.CreditAmount)).toEqual([50, 100]);
    expect(result.map((line: any) => line.PaymentId)).toEqual([
      '77,3',
      '77,4',
    ]);
    expect(result.map((line: any) => line.LineNumber)).toEqual([3, 4]);
  });

  it('groups repeated rows for one customer into one amount against a single payment offset', () => {
    const processor = createProcessor();
    const result = (processor as any).buildLines('88', [
      customerLine({
        UniqueId: 88,
        LINENUMBER: 5,
        ACCOUNTDISPLAYVALUE: 'Customer-001',
        CREDITAMOUNT: 100,
      }),
      customerLine({
        UniqueId: 88,
        LINENUMBER: 6,
        ACCOUNTDISPLAYVALUE: 'Customer-001',
        CREDITAMOUNT: 50,
      }),
      offsetLine({
        UniqueId: 88,
        LINENUMBER: 7,
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'BANK-ONE',
        DEBITAMOUNT: 999,
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].AccountType).toBe('Cust');
    expect(result[0].AccountDisplayValue).toBe('Customer-001');
    expect(result[0].OffsetAccountType).toBe('Bank');
    expect(result[0].OffsetAccountDisplayValue).toBe('BANK-ONE');
    expect(result[0].CreditAmount).toBe(150);
    expect(result[0].DebitAmount).toBe(0);
    expect(result[0].PaymentId).toBe('88,7');
    expect(result[0].LineNumber).toBe(7);
  });

  it('keeps the existing 421103 skip behavior', () => {
    const processor = createProcessor();
    const result = (processor as any).buildLines('1', [
      customerLine(),
      offsetLine({ LINENUMBER: 2, ACCOUNTDISPLAYVALUE: 'PETTY-001' }),
      new CashEntryRawDataModel(
        {
          UniqueId: 1,
          LINENUMBER: 3,
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE:
            '421103|1301|013|001|001|101000046||||||||||IMPORT||||',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 100,
          CURRENCYCODE: 'EGP',
          SafeType: 'Customer Collection',
          VoucherType: 'Cash',
        } as any,
        'Freight',
        true,
      ),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].OffsetAccountDisplayValue).toBe('PETTY-001');
  });

  it('skips 421103 and applies the valid Petty Cash currency to the Customer entry', () => {
    const processor = createProcessor();
    const customer = customerLine({ CURRENCYCODE: 'EGP', CREDITAMOUNT: 100 });
    const pettyCash = offsetLine({
      LINENUMBER: 2,
      ACCOUNTDISPLAYVALUE: 'PETTY-USD',
      CURRENCYCODE: 'USD',
      DEBITAMOUNT: 100,
    });
    const settlement = new CashEntryRawDataModel(
      {
        UniqueId: 1,
        LINENUMBER: 3,
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE:
          '421103|1301|013|001|001|101000046||||||||||IMPORT||||',
        DEBITAMOUNT: 100,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EUR',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      } as any,
      'Freight',
      true,
    );

    CashIn421103CurrencyPolicy.apply({
      uniqueId: 1,
      safeType: 'Customer Collection',
      lines: [customer, pettyCash, settlement],
    });

    const [line] = (processor as any).buildLines('1', [
      customer,
      pettyCash,
      settlement,
    ]);

    expect(line.OffsetAccountDisplayValue).toBe('PETTY-USD');
    expect(line.CurrencyCode).toBe('USD');
    expect(line.CreditAmount).toBe(100);
    expect(line.GetErrors()).not.toContain(
      'InvalidMapping: No offset line found',
    );
  });

  it('reports a missing offset when no source offset exists', () => {
    const processor = createProcessor();
    const result = (processor as any).buildLines('1', [customerLine()]);

    expect(result).toEqual([]);
  });
});
