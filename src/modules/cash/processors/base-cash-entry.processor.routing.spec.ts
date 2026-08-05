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
    ['Custody Settlement', 'P-Freight'],
    ['Custody Issue', 'P-Freight'],
    ['Customer Collection', 'Cust-Pay'],
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

  it('formats outbound DownPayment as line-based AR rows (no offset conversion)', () => {
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

    const formatted = (processor as any).buildLines('2045', rawLines);

    expect(formatted).toHaveLength(2);
    expect(formatted[0]).toMatchObject({
      AccountType: 'Cust',
      JournalName: 'Cust-Pay',
      PostingProfile: 'Cust-PP',
      SafeType: 'DownPayment',
      DebitAmount: 100,
      CreditAmount: 0,
    });
    expect(formatted[0].OffsetAccountDisplayValue).toBeFalsy();
    expect(formatted[0].MarkedLines).toEqual([]);
    expect(formatted[1]).toMatchObject({
      AccountType: 'Petty cash',
      AccountDisplayValue: 'SAFE-001',
      CreditAmount: 100,
      DebitAmount: 0,
    });
    expect(formatted[0].Description).toContain('DownPayment - Freight');
  });

  it.each([
    'DownPayment',
    'CN',
    'Direct',
    'Other',
    'Custody Settlement',
    'Customer Collection',
  ])(
    'does not apply invoice-settlement validation to the %s route',
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

  it('builds main-account-only Vendor Payment lines when the UniqueId has no payment offset', () => {
    const processor = createProcessor();
    jest
      .spyOn(processor as any, 'fetchExchangeRates')
      .mockReturnValue({ exchangeRate: 100, reportingRate: 0 });

    const rawLines = [
      {
        UniqueId: 475288,
        LINENUMBER: 1,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'VEND-001',
        DEFAULTDIMENSIONDISPLAYVALUE: '|1201|012|001|001||||||||||||||',
        DEBITAMOUNT: 125,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        INVOICE: 'INV-475288',
        SafeType: 'Vendor Payment',
        VoucherType: 'Cash',
      },
    ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

    const [formatted] = (processor as any).buildLines('475288', rawLines);

    expect(formatted.AccountDisplayValue).toBe('VEND-001');
    expect(formatted.DebitAmount).toBe(125);
    expect(formatted.CreditAmount).toBe(0);
    expect(formatted.OffsetAccountDisplayValue).toBeFalsy();
    expect(formatted.OffsetAccountType).toBeFalsy();
    expect(formatted.SafeType).toBe('Vendor Payment');
    expect(formatted.GetErrors?.() ?? []).toEqual([]);
  });

  it('builds Ledger-only Vendor Payment UniqueIds as main-account-only lines', () => {
    const processor = createProcessor();
    jest
      .spyOn(processor as any, 'fetchExchangeRates')
      .mockReturnValue({ exchangeRate: 100, reportingRate: 0 });

    const ledgerDisplayValue =
      '223404|2101|021|002|007|101000084|101000084|Tr-000052|Tr-000052|745|12021|12016|Payable|13||DOMESTIC||||';
    const rawLines = [
      {
        UniqueId: 475358,
        LINENUMBER: 1,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: ledgerDisplayValue,
        DEBITAMOUNT: 1000,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        SafeType: 'Vendor Payment',
        VoucherType: 'Cash',
      },
    ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

    const [formatted] = (processor as any).buildLines('475358', rawLines);

    expect(formatted.AccountType).toBe('Ledger');
    expect(formatted.AccountDisplayValue).toBe(ledgerDisplayValue);
    expect(formatted.DebitAmount).toBe(1000);
    expect(formatted.OffsetAccountDisplayValue).toBeFalsy();
    expect(formatted.OffsetAccountType).toBeFalsy();
    expect(formatted.SafeType).toBe('Vendor Payment');
  });

  describe('Bug 2046 - MarkedInvoice clearing & unmarked description rules', () => {
    it('adds a blocking validation error when invoice belongs to another vendor', () => {
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

      expect(line.MarkedInvoice).toBe('INV-MISMATCH');
      expect(line.AddError).toHaveBeenCalledWith(
        'MarkedInvoice',
        expect.stringContaining('was not found in D365 for vendor VEND-001'),
      );
    });

    it('keeps MarkedInvoice for partial payments so D365 can validate the remaining balance', () => {
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
      expect(formatted.MarkedInvoice).toBe('INV-2026-PARTIAL');
      expect(formatted.Description).not.toContain(' - unmarked');
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
    it('retains MarkedInvoice and normal description when withholding tax is enabled on payment line', () => {
      const processor = createProcessor();
      const rawLines = [
        {
          UniqueId: 2046,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-001',
          DEFAULTDIMENSIONDISPLAYVALUE: '|1201|012|001|001||||||||||||||',
          DEBITAMOUNT: 990,
          CREDITAMOUNT: 0,
          INVOICEAMOUNT: 1000,
          ISWITHHOLDINGCALCULATIONENABLED: 'Yes',
          ITEMWITHHOLDINGTAXGROUPCODE: 'TAX1',
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-2026-WITHHOLDING',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 2046,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
          CREDITAMOUNT: 990,
          DEBITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
      ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

      const [formatted] = (processor as any).buildLines('2046', rawLines);

      expect(formatted.Invoice).toBe('INV-2026-WITHHOLDING');
      expect(formatted.MarkedInvoice).toBe('INV-2026-WITHHOLDING');
      expect(formatted.Description).not.toContain(' - unmarked');
    });

    it('PBI 2055: keeps 223304 withholding lines and does not reduce vendor amount', () => {
      const processor = createProcessor();
      const rawLines = [
        {
          UniqueId: 2047,
          LINENUMBER: 1,
          VOUCHER: 'VCH-01',
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-001',
          DEFAULTDIMENSIONDISPLAYVALUE: '|1201|012|001|001||||||||||||||',
          DEBITAMOUNT: 1000,
          CREDITAMOUNT: 0,
          INVOICEAMOUNT: 1000,
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-2026-WITHHOLDING-LINE',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 2047,
          LINENUMBER: 2,
          VOUCHER: 'VCH-01',
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '223304-01',
          CREDITAMOUNT: 10,
          DEBITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-2026-WITHHOLDING-LINE',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 2047,
          LINENUMBER: 3,
          VOUCHER: 'VCH-01',
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
          CREDITAMOUNT: 990,
          DEBITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
      ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

      const { lines: processedLines, stats } = (
        processor as any
      ).applyWithholdingReductions(rawLines);

      // All 3 lines are kept (223304 line is NOT removed)
      expect(processedLines).toHaveLength(3);
      // Vendor line amount is NOT reduced (keeps full invoice + tax)
      expect(processedLines[0].DEBITAMOUNT).toBe(1000);
      // Stats still report withholding info
      expect(stats.withholdingRemovedCount).toBe(1);
      expect(stats.withholdingRemovedAmount).toBe(10);
    });

    it('PERMANENT: 2 vendor debits + 1 credit offset → one FO line with summed amount', () => {
      const processor = createProcessor();
      jest
        .spyOn(processor as any, 'fetchExchangeRates')
        .mockReturnValue({ exchangeRate: 100, reportingRate: 0 });

      const rawLines = [
        {
          UniqueId: 480001,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-001',
          DEFAULTDIMENSIONDISPLAYVALUE: '|1201|012|001|001||||||||||||||',
          DEBITAMOUNT: 600,
          CREDITAMOUNT: 0,
          INVOICEAMOUNT: 600,
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-A',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 480001,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vendor',
          ACCOUNTDISPLAYVALUE: 'VEND-001',
          DEFAULTDIMENSIONDISPLAYVALUE: '|1201|012|001|001||||||||||||||',
          DEBITAMOUNT: 400,
          CREDITAMOUNT: 0,
          INVOICEAMOUNT: 400,
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-B',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 480001,
          LINENUMBER: 3,
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
      // Simulate hydrated vs empty VendorGroup — must still merge.
      rawLines[0].VendorGroup = 'Trade';
      rawLines[1].VendorGroup = '';

      const dfoLines = (processor as any).buildLines('480001', rawLines);

      expect(dfoLines).toHaveLength(1);
      expect(dfoLines[0]).toMatchObject({
        AccountType: 'Vend',
        AccountDisplayValue: 'VEND-001',
        DebitAmount: 1000,
        CreditAmount: 0,
        OffsetAccountType: 'Bank',
        OffsetAccountDisplayValue: 'BANK-001',
        Invoice: 'INV-A',
        MarkedInvoice: 'INV-A',
      });
      expect(dfoLines[0].MarkedLines).toHaveLength(2);
      expect(dfoLines[0].MarkedLines).toEqual([
        expect.objectContaining({ InvoiceNumber: 'INV-A' }),
        expect.objectContaining({ InvoiceNumber: 'INV-B' }),
      ]);
      // Guard against the one-FO-line-per-debit regression.
      expect(dfoLines.map((line: any) => line.DebitAmount)).not.toEqual([
        600, 400,
      ]);
    });

    it('does not emit MarkedLines for Custody Settlement vendor lines', () => {
      const processor = createProcessor();
      jest
        .spyOn(processor as any, 'fetchExchangeRates')
        .mockReturnValue({ exchangeRate: 100, reportingRate: 0 });

      const rawLines = [
        {
          UniqueId: 480002,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'CUSTODY-1',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 100,
          CURRENCYCODE: 'EGP',
          DOCUMENT: 'DOC-1',
          FINTAGDISPLAYVALUE: 'OP-1|TAG',
          SafeType: 'Custody Settlement',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 480002,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-TRADE',
          DEBITAMOUNT: 100,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          DOCUMENT: 'DOC-1',
          INVOICE: 'INV-CS',
          SafeType: 'Custody Settlement',
          VoucherType: 'Cash',
        },
      ].map((line) => {
        const model = new CashEntryRawDataModel(line as any, 'Freight');
        if (model.ACCOUNTDISPLAYVALUE === 'CUSTODY-1') {
          model.VendorGroup = 'Custody';
          model.IsCustodyVendor = true;
        } else {
          model.VendorGroup = 'Trade';
        }
        return model;
      });

      const dfoLines = (processor as any).buildLines('480002', rawLines);

      expect(dfoLines).toHaveLength(2);
      expect(dfoLines.every((line: any) => line.MarkedLines.length === 0)).toBe(
        true,
      );
      expect(dfoLines.every((line: any) => line.MarkedInvoice === '')).toBe(
        true,
      );
      expect(
        dfoLines.every((line: any) => line.SettlementTargetType === 'None'),
      ).toBe(true);
    });

    it('keeps Custody Settlement withholding as a separate FO line (no VP merge)', () => {
      const processor = createProcessor();
      jest
        .spyOn(processor as any, 'fetchExchangeRates')
        .mockReturnValue({ exchangeRate: 100, reportingRate: 0 });

      const rawLines = [
        {
          UniqueId: 480003,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-001',
          DEBITAMOUNT: 1000,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-CS-WH',
          SafeType: 'Custody Settlement',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 480003,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 900,
          CURRENCYCODE: 'EGP',
          SafeType: 'Custody Settlement',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 480003,
          LINENUMBER: 3,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '223304-01',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 100,
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-CS-WH',
          SafeType: 'Custody Settlement',
          VoucherType: 'Cash',
        },
      ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

      const dfoLines = (processor as any).buildLines('480003', rawLines);

      expect(dfoLines).toHaveLength(3);
      expect(dfoLines.map((line: any) => line.AccountDisplayValue)).toEqual([
        'VEND-001',
        'BANK-001',
        '223304-01',
      ]);
      expect(
        dfoLines.every((line: any) => !line.OffsetAccountDisplayValue),
      ).toBe(true);
      expect(dfoLines.every((line: any) => line.MarkedLines.length === 0)).toBe(
        true,
      );
    });

    it('uses withholding-row invoice for Vendor Payment MarkedLines when vendor invoice is blank', () => {
      const processor = createProcessor();
      jest
        .spyOn(processor as any, 'fetchExchangeRates')
        .mockReturnValue({ exchangeRate: 100, reportingRate: 0 });

      const rawLines = [
        {
          UniqueId: 480004,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-001',
          DEFAULTDIMENSIONDISPLAYVALUE: '|1201|012|001|001||||||||||||||',
          DEBITAMOUNT: 1000,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: '',
          DOCUMENT: 'DOC-WH',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 480004,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '223304-01',
          CREDITAMOUNT: 50,
          DEBITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-FROM-WHT',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 480004,
          LINENUMBER: 3,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
          CREDITAMOUNT: 950,
          DEBITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
      ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

      const dfoLines = (processor as any).buildLines('480004', rawLines);

      expect(dfoLines).toHaveLength(1);
      expect(dfoLines[0].DebitAmount).toBe(1000);
      expect(dfoLines[0].OffsetAccountDisplayValue).toBe('BANK-001');
      expect(dfoLines[0].MarkedLines).toEqual([
        expect.objectContaining({
          InvoiceNumber: 'INV-FROM-WHT',
          HasWithHoldingLine: true,
        }),
      ]);
    });

    it('PBI 2065: merges withholding into the Vendor Payment offset line', () => {
      const processor = createProcessor();
      const rawLines = [
        {
          UniqueId: 2055,
          LINENUMBER: 1,
          VOUCHER: 'VCH-WH',
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-001',
          DEFAULTDIMENSIONDISPLAYVALUE: '|1201|012|001|001||||||||||||||',
          DEBITAMOUNT: 1000,
          CREDITAMOUNT: 0,
          INVOICEAMOUNT: 1000,
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-2055',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 2055,
          LINENUMBER: 2,
          VOUCHER: 'VCH-WH',
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '223304-01',
          CREDITAMOUNT: 50,
          DEBITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-2055',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 2055,
          LINENUMBER: 3,
          VOUCHER: 'VCH-WH',
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
          CREDITAMOUNT: 950,
          DEBITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
      ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

      // applyWithholdingReductions keeps all lines unchanged
      const { lines: processedLines } = (
        processor as any
      ).applyWithholdingReductions(rawLines);
      expect(processedLines).toHaveLength(3);

      // Vendor Payment produces one gross vendor line; 223304 is not posted separately.
      const dfoLines = (processor as any).buildLines('2055', processedLines);
      expect(dfoLines).toHaveLength(1);

      const [bankLine] = dfoLines;
      expect(bankLine.AccountType).toBe('Vend');
      expect(bankLine.AccountDisplayValue).toBe('VEND-001');
      expect(bankLine.OffsetAccountDisplayValue).toBe('BANK-001');
      expect(bankLine.DebitAmount).toBe(1000);
      expect(bankLine.IsWithholdingCalculationEnabled).toBe('Yes');
      expect(bankLine.Invoice).toBe('INV-2055');
    });
  });
});
