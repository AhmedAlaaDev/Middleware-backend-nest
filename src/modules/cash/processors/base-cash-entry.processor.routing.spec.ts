import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/cash-out-freight-entry.processor';
import { CashOutTruckingEntryProcessor } from '@/modules/cash/processors/cash-out-trucking-entry.processor';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('BaseCashEntryProcessor - task 2045 formatting', () => {
  const createProcessor = (target: 'Freight' | 'Fleet' = 'Freight') => {
    const Processor =
      target === 'Freight'
        ? CashOutFreightEntryProcessor
        : CashOutTruckingEntryProcessor;
    const processor = new Processor(
      { execute: jest.fn() } as any,
      {
        queryBus: { execute: jest.fn() },
        exchangeRateService: {},
        utilsService: new EntryProcessorUtilsService(),
        dimensionService: new DimensionValidationService(),
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService: {},
      } as any,
    );
    (processor as any).company = 'm-p';
    (processor as any).vendorNameMap = new Map();
    jest.spyOn(processor as any, 'fetchExchangeRates').mockReturnValue({
      exchangeRate: 1,
      reportingRate: 1,
    });
    return processor;
  };

  it.each([
    ['Custody Settlement', 'CustSettle'],
    ['Custody Issue', 'CashOut'],
    ['Direct', 'CashOut'],
    ['Other', 'CashOut'],
    ['DownPayment', 'Cust-Pay'],
    ['CN', 'Cust-Pay'],
  ])('formats Safe Type %s with journal %s', (safeType, expectedJournal) => {
    const processor = createProcessor();

    expect((processor as any).getJournalName(safeType)).toBe(expectedJournal);
  });

  it.each([
    ['Freight', 'P-Freight'],
    ['Fleet', 'P-Fleet'],
  ] as const)(
    'formats Vendor Payment target %s with journal %s',
    (target, expectedJournal) => {
      const processor = createProcessor(target);

      expect((processor as any).getJournalName('Vendor Payment')).toBe(
        expectedJournal,
      );
    },
  );

  it('formats outbound DownPayment as an AR customer-payment line', () => {
    const processor = createProcessor();
    const rawLines = [
      {
        UniqueId: 2045,
        LINENUMBER: 1,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Cust',
        ACCOUNTDISPLAYVALUE: 'CUST-001',
        DEFAULTDIMENSIONDISPLAYVALUE:
          '|1201|012|001|001|CUST-001||||||||Payable|||IMPORT||||',
        DEBITAMOUNT: 100,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        INVOICE: 'INV-AR-001',
        SafeType: 'DownPayment',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 2045,
        LINENUMBER: 2,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Petty cash',
        ACCOUNTDISPLAYVALUE: 'SAFE-001',
        CREDITAMOUNT: 100,
        DEBITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        SafeType: 'DownPayment',
        VoucherType: 'Cash',
      },
    ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

    const [formatted] = (processor as any).buildLines('2045', rawLines);

    expect(formatted).toMatchObject({
      AccountType: 'Cust',
      JournalName: 'Cust-Pay',
      PostingProfile: '',
      SafeType: 'DownPayment',
    });
    expect(formatted.Description).toContain('DownPayment - Freight');
  });

  it.each(['DownPayment', 'CN', 'Direct', 'Other', 'Custody Settlement'])(
    'does not apply vendor-invoice validation to the %s non-AP route',
    (safeType) => {
      const processor = createProcessor();
      jest
        .spyOn(processor as any, 'validateDimensionsForLine')
        .mockImplementation(() => undefined);
      const vendorValidation = jest
        .spyOn(processor as any, 'validateCashOutMarkedInvoice')
        .mockImplementation(() => undefined);
      const line = {
        SourceIds: ['2045'],
        SafeType: safeType,
        VoucherType: 'Cash',
        AccountType: 'Cust',
        AddError: jest.fn(),
      };

      processor.validateAsync([line] as any);

      expect(vendorValidation).not.toHaveBeenCalled();
      expect(line.AddError).not.toHaveBeenCalledWith(
        'SafeType',
        expect.any(String),
      );
    },
  );

  it('applies vendor-invoice validation to Vendor Payment', () => {
    const processor = createProcessor();
    jest
      .spyOn(processor as any, 'validateDimensionsForLine')
      .mockImplementation(() => undefined);
    const vendorValidation = jest
      .spyOn(processor as any, 'validateCashOutMarkedInvoice')
      .mockImplementation(() => undefined);
    const line = {
      SourceIds: ['2045'],
      SafeType: 'Vendor Payment',
      VoucherType: 'Cash',
      AccountType: 'Vend',
      AddError: jest.fn(),
    };

    processor.validateAsync([line] as any);

    expect(vendorValidation).toHaveBeenCalledWith(line);
  });

  describe('Bug 2046 - MarkedInvoice clearing & unmarked description rules', () => {
    it('clears MarkedInvoice and appends " - unmarked" to description without error when invoice belongs to another vendor', () => {
      const processor = createProcessor();
      (processor as any).vendorInvoiceExistsMap = new Set(); // Empty map => invoice does not exist for vendor

      const line: any = {
        MarkedInvoice: 'INV-MISMATCH',
        AccountDisplayValue: 'VEND-001',
        Description: 'Vendor Payment - Freight Jan 2026 (Transfer)',
        TransactionText: 'Vendor Payment - Freight Jan 2026 (Transfer)',
        AddError: jest.fn(),
      };

      (processor as any).validateCashOutMarkedInvoice(line);

      expect(line.MarkedInvoice).toBe('');
      expect(line.Description).toBe(
        'Vendor Payment - Freight Jan 2026 (Transfer) - unmarked',
      );
      expect(line.TransactionText).toBe(
        'Vendor Payment - Freight Jan 2026 (Transfer) - unmarked',
      );
      expect(line.AddError).not.toHaveBeenCalled();
    });

    it('clears MarkedInvoice and appends " - unmarked" when invoice amount exceeds payment line amount [Partial Payment]', () => {
      const processor = createProcessor();
      const rawLines = [
        {
          UniqueId: 2046,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-001',
          DEFAULTDIMENSIONDISPLAYVALUE: '|1201|012|001|001||||||||||||||',
          DEBITAMOUNT: 400,
          CREDITAMOUNT: 0,
          INVOICEAMOUNT: 1000,
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-2026-PARTIAL',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 2046,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
          CREDITAMOUNT: 400,
          DEBITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
      ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

      const [formatted] = (processor as any).buildLines('2046', rawLines);

      expect(formatted.Invoice).toBe('INV-2026-PARTIAL');
      expect(formatted.MarkedInvoice).toBe('');
      expect(formatted.Description).toContain(' - unmarked');
    });

    it('retains MarkedInvoice and normal description when payment can be settled against invoice', () => {
      const processor = createProcessor();
      const rawLines = [
        {
          UniqueId: 2046,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-001',
          DEFAULTDIMENSIONDISPLAYVALUE: '|1201|012|001|001||||||||||||||',
          DEBITAMOUNT: 1000,
          CREDITAMOUNT: 0,
          INVOICEAMOUNT: 1000,
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-2026-FULL',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 2046,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
          CREDITAMOUNT: 1000,
          DEBITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
      ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

      const [formatted] = (processor as any).buildLines('2046', rawLines);

      expect(formatted.Invoice).toBe('INV-2026-FULL');
      expect(formatted.MarkedInvoice).toBe('INV-2026-FULL');
      expect(formatted.Description).not.toContain(' - unmarked');
    });
  });
});
