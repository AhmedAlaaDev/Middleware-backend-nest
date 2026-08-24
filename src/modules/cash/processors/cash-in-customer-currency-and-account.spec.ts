import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
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

    expect(line.PaymentId).toBe('536999,21');
    expect(line.LineNumber).toBe(21);
  });

  it('creates one paired line per customer when one offset serves several customers', () => {
    const processor = createProcessor();
    const result = (processor as any).buildLines('1', [
      customerLine({ ACCOUNTDISPLAYVALUE: 'Customer-001', LINENUMBER: 1 }),
      customerLine({
        ACCOUNTDISPLAYVALUE: 'Customer-002',
        LINENUMBER: 2,
        CREDITAMOUNT: 50,
      }),
      offsetLine({ LINENUMBER: 3, DEBITAMOUNT: 150 }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((line: any) => line.AccountDisplayValue)).toEqual([
      'Customer-001',
      'Customer-002',
    ]);
    expect(
      result.every((line: any) => line.OffsetAccountType === 'Petty cash'),
    ).toBe(true);
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

  it('reports a missing offset when no source offset exists', () => {
    const processor = createProcessor();
    const [line] = (processor as any).buildLines('1', [customerLine()]);

    expect(line.GetErrors()).toContain(
      'InvalidMapping: Unable to determine the corresponding non-customer line for the customer transaction.',
    );
  });
});
