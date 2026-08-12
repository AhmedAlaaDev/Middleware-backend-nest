import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashInFreightEntryProcessor } from '@/modules/cash/processors/cash-in-freight-entry.processor';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('Cash-In notes-receivable standalone lines', () => {
  const utilsService = new EntryProcessorUtilsService();

  /** 20 segments; bankAccount (index 19) empty — mirrors FO BankAccountTable miss. */
  const nrLedgerEmptyBank =
    '122201|1301|013|001|001|||||||Payable|||IMPORT|||||';

  /** Same 20-segment shape with bank id in segment 19. */
  const nrLedgerWithBank =
    '122201|1301|013|001|001|||||||Payable|||IMPORT|||||AAIB-EG-CA';

  const createProcessor = () => {
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
    (processor as any).customerNameMap = new Map([['CUST-1', 'Customer 1']]);
    jest
      .spyOn(processor as any, 'validateDimensionsForLine')
      .mockImplementation(() => undefined);
    jest.spyOn(processor as any, 'fetchExchangeRates').mockReturnValue({
      exchangeRate: 1,
      reportingRate: 1,
    });
    return processor;
  };

  const buildNrPair = (ledgerDisplay: string) =>
    [
      {
        UniqueId: 468100,
        LINENUMBER: 1,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'CUST-1',
        DEFAULTDIMENSIONDISPLAYVALUE:
          '|1301|013|001|001|CUST-1||||||||Payable|||IMPORT||||',
        DEBITAMOUNT: 1000,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        INVOICE: '000008898/OR-TR',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 468100,
        LINENUMBER: 2,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: ledgerDisplay,
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 1000,
        CURRENCYCODE: 'EGP',
        SafeType: 'Customer Collection',
        VoucherType: 'Cash',
      },
    ].map((line) => new CashEntryRawDataModel(line as any, 'Freight', true));

  it('keeps the customer and ledger rows as separate primary lines', () => {
    const processor = createProcessor();
    const formatted = (processor as any).buildLines(
      '468100',
      buildNrPair(nrLedgerEmptyBank),
    );

    expect(formatted).toHaveLength(2);
    expect(formatted.map((line: any) => line.AccountType)).toEqual([
      'Cust',
      'Ledger',
    ]);
    expect(formatted[1].AccountDisplayValue).toContain('122201');
    expect(
      formatted.every(
        (line: any) =>
          line.OffsetAccountType === '' &&
          line.OffsetAccountDisplayValue === '',
      ),
    ).toBe(true);
  });

  it('does not convert a standalone ledger row into a Bank offset', () => {
    const processor = createProcessor();
    const formatted = (processor as any).buildLines(
      '468100',
      buildNrPair(nrLedgerWithBank),
    );

    expect(formatted).toHaveLength(2);
    expect(formatted[1].AccountType).toBe('Ledger');
    expect(formatted[1].AccountDisplayValue).toContain('122201');
    expect(formatted[1].OffsetAccountType).toBe('');
    expect(formatted[1].OffsetAccountDisplayValue).toBe('');
  });

  it('passes validateAsync when NR falls back to Ledger (no bank segment)', () => {
    const processor = createProcessor();
    (processor as any).freeTextInvoiceMap = new Map([
      [
        '000008898/or-tr',
        [{ invoiceNumber: '000008898/OR-TR', exists: true, isPosted: true }],
      ],
    ]);

    const [formatted] = (processor as any).buildLines(
      '468100',
      buildNrPair(nrLedgerEmptyBank),
    );
    const [validated] = processor.validateAsync([formatted]);

    // Ledger offset does not trigger the Bank-account-required validation.
    const bankErrors = validated
      .GetErrors()
      .filter(
        (e: string) =>
          e.includes('Bank account is required') &&
          e.includes('OffsetAccountDisplayValue'),
      );
    expect(bankErrors).toHaveLength(0);
  });

  it('fails validateAsync when a Bank display value is a ledger pipe string', () => {
    const processor = createProcessor();
    (processor as any).freeTextInvoiceMap = new Map();

    const line = new CashEntryDynDataModel(null, {
      SourceIds: ['1'],
      AccountType: 'Cust',
      OffsetAccountType: 'Bank',
      OffsetAccountDisplayValue: '122201|1301|013|001|',
      MarkedInvoice: '',
      Invoice: '',
    } as any);

    const [validated] = processor.validateAsync([line]);
    expect(validated.ErrorCount).toBeGreaterThan(0);
    expect(
      validated
        .GetErrors()
        .some((e: string) => e.includes('ledger dimension value')),
    ).toBe(true);
  });

});
