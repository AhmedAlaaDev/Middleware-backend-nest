import { readFile } from 'fs/promises';
import { join } from 'path';

import { Workbook } from 'exceljs';

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
      PostingProfile: '',
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

  it.each(['Vendor Payment', 'Custody Settlement'] as const)(
    'applies vendor-invoice validation to %s when SettlementTargetType is VendorInvoice',
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
        AccountType: 'Vend',
        SettlementTargetType: 'VendorInvoice',
        AddError: jest.fn(),
      };

      processor.validateAsync([line] as any);

      expect(vendorValidation).toHaveBeenCalledWith(line);
    },
  );

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

    it('2 vendor debits + 1 credit offset → one FO line per vendor with original debit amounts', () => {
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
      rawLines[0].VendorGroup = 'Trade';
      rawLines[1].VendorGroup = '';

      const dfoLines = (processor as any).buildLines('480001', rawLines);

      expect(dfoLines).toHaveLength(2);
      expect(dfoLines.map((line: any) => line.DebitAmount)).toEqual([600, 400]);
      expect(dfoLines.every((line: any) => line.CreditAmount === 0)).toBe(true);
      expect(
        dfoLines.every((line: any) => line.AccountDisplayValue === 'VEND-001'),
      ).toBe(true);
      expect(
        dfoLines.every(
          (line: any) => line.OffsetAccountDisplayValue === 'BANK-001',
        ),
      ).toBe(true);
      // Must never copy the payment credit (1000) onto each vendor line.
      expect(dfoLines.every((line: any) => line.DebitAmount !== 1000)).toBe(
        true,
      );
      expect(dfoLines[0].MarkedLines).toEqual([
        expect.objectContaining({ InvoiceNumber: 'INV-A' }),
      ]);
      expect(dfoLines[1].MarkedLines).toEqual([
        expect.objectContaining({ InvoiceNumber: 'INV-B' }),
      ]);
    });

    it('keeps different vendor accounts separate while sharing one payment offset', () => {
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
          ACCOUNTDISPLAYVALUE: 'VEND-A',
          DEFAULTDIMENSIONDISPLAYVALUE: '|1201|012|001|001||||||||||||||',
          DEBITAMOUNT: 600,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-A',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 480003,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vendor',
          ACCOUNTDISPLAYVALUE: 'VEND-B',
          DEFAULTDIMENSIONDISPLAYVALUE: '|1201|012|001|001||||||||||||||',
          DEBITAMOUNT: 400,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: 'INV-B',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 480003,
          LINENUMBER: 3,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 1000,
          CURRENCYCODE: 'EGP',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
      ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

      const dfoLines = (processor as any).buildLines('480003', rawLines);

      expect(dfoLines).toHaveLength(2);
      expect(dfoLines).toEqual([
        expect.objectContaining({
          AccountDisplayValue: 'VEND-A',
          DebitAmount: 600,
          OffsetAccountDisplayValue: 'BANK-001',
          PaymentId: '480003',
          MarkedLines: [expect.objectContaining({ InvoiceNumber: 'INV-A' })],
        }),
        expect.objectContaining({
          AccountDisplayValue: 'VEND-B',
          DebitAmount: 400,
          OffsetAccountDisplayValue: 'BANK-001',
          PaymentId: '480003',
          MarkedLines: [expect.objectContaining({ InvoiceNumber: 'INV-B' })],
        }),
      ]);
      expect(
        dfoLines.reduce(
          (total: number, line: any) => total + line.DebitAmount,
          0,
        ),
      ).toBe(1000);
    });

    it('emits custody vs standard MarkedLines for Custody Settlement vendor lines', () => {
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
          FINTAGDISPLAYVALUE: 'OP-2|TAG',
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
      expect(dfoLines[0]).toMatchObject({
        SettlementTargetType: 'CustodyLedger',
        MarkedInvoice: '',
        MarkedLines: [
          {
            InvoiceNumber: '',
            OperationNumber: 'OP-1',
            DocumentNumber: 'DOC-1',
            HasWithHoldingLine: false,
          },
        ],
      });
      expect(dfoLines[1]).toMatchObject({
        SettlementTargetType: 'VendorInvoice',
        MarkedInvoice: 'INV-CS',
        MarkedLines: [
          {
            InvoiceNumber: 'INV-CS',
            OperationNumber: 'OP-2',
            DocumentNumber: '',
            HasWithHoldingLine: false,
          },
        ],
      });
    });

    it('keeps Custody Settlement withholding separate and leaves vendor lines unmarked', () => {
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
          FINTAGDISPLAYVALUE: 'OP-WH|TAG',
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
      expect(dfoLines[0].SettlementTargetType).toBe('None');
      expect(dfoLines[0].Description).toContain('Unmarked');
      expect(dfoLines[0].TransactionText).toContain('Unmarked');
      expect(dfoLines[1].Description).not.toContain('Unmarked');
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

      expect(dfoLines).toHaveLength(2);
      const paymentLine = dfoLines.find(
        (line: any) => line.OffsetAccountDisplayValue === 'BANK-001',
      );
      const withholdingLine = dfoLines.find((line: any) =>
        String(line.OffsetAccountDisplayValue ?? '').includes('223304'),
      );

      expect(paymentLine).toMatchObject({
        // Vendor debit 1000 − withholding 50 = 950 (do not keep gross 1000).
        DebitAmount: 950,
        CreditAmount: 0,
        OffsetAccountDisplayValue: 'BANK-001',
      });
      // Payment line settles; 223304 companion line must not double-mark.
      expect(paymentLine.MarkedLines).toEqual([
        expect.objectContaining({
          InvoiceNumber: 'INV-FROM-WHT',
          HasWithHoldingLine: true,
        }),
      ]);
      expect(withholdingLine).toMatchObject({
        AccountDisplayValue: 'VEND-001',
        DebitAmount: 50,
        CreditAmount: 0,
      });
      expect(withholdingLine.MarkedLines).toEqual([]);
      expect(withholdingLine.MarkedInvoice).toBe('');
    });

    it('PBI 2065: posts vendor payment and matched 223304 withholding as separate FO lines', () => {
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

      const { lines: processedLines } = (
        processor as any
      ).applyWithholdingReductions(rawLines);
      expect(processedLines).toHaveLength(3);

      const dfoLines = (processor as any).buildLines('2055', processedLines);
      expect(dfoLines).toHaveLength(2);

      const paymentLine = dfoLines.find(
        (line: any) => line.OffsetAccountDisplayValue === 'BANK-001',
      );
      const withholdingLine = dfoLines.find((line: any) =>
        String(line.OffsetAccountDisplayValue ?? '').startsWith('223304'),
      );

      expect(paymentLine).toMatchObject({
        AccountType: 'Vend',
        AccountDisplayValue: 'VEND-001',
        DebitAmount: 950,
        CreditAmount: 0,
        OffsetAccountDisplayValue: 'BANK-001',
        Invoice: 'INV-2055',
      });
      expect(paymentLine.MarkedLines).toEqual([
        expect.objectContaining({
          InvoiceNumber: 'INV-2055',
          HasWithHoldingLine: true,
        }),
      ]);
      expect(withholdingLine).toMatchObject({
        AccountType: 'Vend',
        AccountDisplayValue: 'VEND-001',
        DebitAmount: 50,
        CreditAmount: 0,
        OffsetAccountType: 'Ledger',
      });
      expect(String(withholdingLine.OffsetAccountDisplayValue)).toContain(
        '223304',
      );
      // WHT companion must not settle — payment line already marked INV-2055.
      expect(withholdingLine.MarkedLines).toEqual([]);
      expect(withholdingLine.MarkedInvoice).toBe('');
      // WHT companion description carries the withholding invoice + amount.
      expect(withholdingLine.Description).toBe(
        'Vendor Payment - Freight January 2026 (Transfer) - Inv INV-2055 - 50.00',
      );
    });

    it('matches each 223304 withholding credit to its vendor invoice as a separate FO line', () => {
      const processor = createProcessor();
      jest
        .spyOn(processor as any, 'fetchExchangeRates')
        .mockReturnValue({ exchangeRate: 100, reportingRate: 0 });

      const rawLines = [
        {
          UniqueId: 467706,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'Su-000068',
          DEBITAMOUNT: 912,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: '3829',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 467706,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'Su-000068',
          DEBITAMOUNT: 855,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: '3844',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 467706,
          LINENUMBER: 3,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '223304|1101|011|001',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 24,
          CURRENCYCODE: 'EGP',
          INVOICE: '3829',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 467706,
          LINENUMBER: 4,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '223304|1101|011|001',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 45,
          CURRENCYCODE: 'EGP',
          INVOICE: '3844',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
        {
          UniqueId: 467706,
          LINENUMBER: 5,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '223201|1101|011|001',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 1698,
          CURRENCYCODE: 'EGP',
          SafeType: 'Vendor Payment',
          VoucherType: 'Transfer',
        },
      ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

      const dfoLines = (processor as any).buildLines('467706', rawLines);
      expect(dfoLines).toHaveLength(4);

      const paymentLines = dfoLines.filter(
        (line: any) =>
          !String(line.OffsetAccountDisplayValue ?? '').startsWith('223304'),
      );
      const withholdingLines = dfoLines.filter((line: any) =>
        String(line.OffsetAccountDisplayValue ?? '').startsWith('223304'),
      );

      expect(paymentLines.map((line: any) => line.DebitAmount).sort()).toEqual([
        810, 888,
      ]);
      expect(
        paymentLines.every(
          (line: any) =>
            line.CreditAmount === 0 &&
            String(line.OffsetAccountDisplayValue).startsWith('223201'),
        ),
      ).toBe(true);
      expect(
        withholdingLines.map((line: any) => line.DebitAmount).sort(),
      ).toEqual([24, 45]);
      expect(
        withholdingLines.every(
          (line: any) =>
            line.AccountDisplayValue === 'Su-000068' && line.CreditAmount === 0,
        ),
      ).toBe(true);
      expect(paymentLines.every((line: any) => line.DebitAmount !== 1698)).toBe(
        true,
      );

      // Marking: only payment lines settle; WHT companions stay unmarked.
      const marksByInvoice = new Map(
        paymentLines.map((line: any) => [
          line.MarkedLines[0].InvoiceNumber,
          line,
        ]),
      );
      expect([...marksByInvoice.keys()].sort()).toEqual(['3829', '3844']);
      expect(marksByInvoice.get('3829').DebitAmount).toBe(888);
      expect(marksByInvoice.get('3844').DebitAmount).toBe(810);
      expect(
        paymentLines.every(
          (line: any) => line.MarkedLines[0].HasWithHoldingLine === true,
        ),
      ).toBe(true);
      expect(
        withholdingLines.every(
          (line: any) =>
            Array.isArray(line.MarkedLines) && line.MarkedLines.length === 0,
        ),
      ).toBe(true);
    });

    it('marks HasWithHoldingLine on every payment line of an invoice that shares one 223304 row', () => {
      const processor = createProcessor();
      jest
        .spyOn(processor as any, 'fetchExchangeRates')
        .mockReturnValue({ exchangeRate: 100, reportingRate: 0 });

      const rawLines = [
        {
          UniqueId: 477553,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'Sl-000081',
          DEBITAMOUNT: 100,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: 'SHARED-INV',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 477553,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'Sl-000081',
          DEBITAMOUNT: 200,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: 'SHARED-INV',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 477553,
          LINENUMBER: 3,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'Sl-000081',
          DEBITAMOUNT: 300,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: 'SHARED-INV',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 477553,
          LINENUMBER: 4,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '223304-01',
          CREDITAMOUNT: 6,
          DEBITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: 'SHARED-INV',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 477553,
          LINENUMBER: 5,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Bank',
          ACCOUNTDISPLAYVALUE: 'BANK-001',
          CREDITAMOUNT: 594,
          DEBITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
      ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

      const dfoLines = (processor as any).buildLines('477553', rawLines);
      // 3 payment lines + 1 WHT companion.
      expect(dfoLines).toHaveLength(4);

      const paymentLines = dfoLines.filter(
        (line: any) =>
          !String(line.OffsetAccountDisplayValue ?? '').startsWith('223304'),
      );
      const withholdingLines = dfoLines.filter((line: any) =>
        String(line.OffsetAccountDisplayValue ?? '').startsWith('223304'),
      );
      expect(paymentLines).toHaveLength(3);
      expect(withholdingLines).toHaveLength(1);

      // Vendor lines post at the net amount (Scenario 3): the shared invoice
      // is reduced proportionally by the withholding so the group pays exactly
      // gross − withheld (594 = 600 − 6) to the bank offset.
      expect(
        paymentLines
          .map((line: any) => line.DebitAmount)
          .sort((a: number, b: number) => a - b),
      ).toEqual([99, 198, 297]);
      expect(
        paymentLines.reduce(
          (total: number, line: any) => total + line.DebitAmount,
          0,
        ),
      ).toBe(594);

      // Every payment line settling the shared invoice reports withholding.
      expect(
        paymentLines.every(
          (line: any) =>
            line.MarkedLines[0]?.InvoiceNumber === 'SHARED-INV' &&
            line.MarkedLines[0].HasWithHoldingLine === true &&
            String(line.IsWithholdingCalculationEnabled) === 'Yes',
        ),
      ).toBe(true);
      // Only one 223304 companion, and it must not settle (double-mark guard).
      expect(withholdingLines[0].MarkedLines).toEqual([]);
      expect(withholdingLines[0].DebitAmount).toBe(6);
    });

    it('matches withholding by exact invoice only (156 does not match 1567)', () => {
      const processor = createProcessor();
      const rawLines = [
        {
          UniqueId: 477560,
          LINENUMBER: 1,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-001',
          DEBITAMOUNT: 100,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: '156',
          DOCUMENT: 'DOC-A',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 477560,
          LINENUMBER: 2,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-001',
          DEBITAMOUNT: 200,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          INVOICE: '1567',
          DOCUMENT: 'DOC-B',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 477560,
          LINENUMBER: 3,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '223304|1301|013',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 10,
          CURRENCYCODE: 'EGP',
          INVOICE: '156',
          DOCUMENT: 'DOC-A',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 477560,
          LINENUMBER: 4,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Petty cash',
          ACCOUNTDISPLAYVALUE: 'PSD EG',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 290,
          CURRENCYCODE: 'EGP',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
      ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

      const dfoLines = (processor as any).buildLines('477560', rawLines);
      const paymentLines = dfoLines.filter(
        (line: any) =>
          !String(line.OffsetAccountDisplayValue ?? '').startsWith('223304'),
      );
      const withholdingLines = dfoLines.filter((line: any) =>
        String(line.OffsetAccountDisplayValue ?? '').startsWith('223304'),
      );

      expect(paymentLines).toHaveLength(2);
      expect(withholdingLines).toHaveLength(1);
      expect(
        paymentLines.find((line: any) => line.Invoice === '156').DebitAmount,
      ).toBe(90);
      expect(
        paymentLines.find((line: any) => line.Invoice === '1567').DebitAmount,
      ).toBe(200);
      expect(withholdingLines[0]).toMatchObject({
        DebitAmount: 10,
        OffsetAccountType: 'Ledger',
      });
    });

    it('assigns shared-invoice withholding companion by accounting shape, then line number', () => {
      const processor = createProcessor();
      const rawLines = [
        {
          UniqueId: 477561,
          LINENUMBER: 10,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'Sl-000081',
          DEFAULTDIMENSIONDISPLAYVALUE:
            '|1301|013|001|005|101000001|101000001|Sl-000081|Sl-000081|',
          FINTAGDISPLAYVALUE: 'OP-OTHER|TAG',
          DEBITAMOUNT: 100,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          DOCUMENT: '17176',
          INVOICE: '156',
          VOUCHER: 'V-1',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 477561,
          LINENUMBER: 20,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'Sl-000081',
          DEFAULTDIMENSIONDISPLAYVALUE:
            '|1301|013|001|005|101000554|101000554|Sl-000081|Sl-000081|16454|3042|5013|Collect|||IMPORT||||',
          FINTAGDISPLAYVALUE: 'O26-IMP-OC-80|ME_Q-20260140997-IMP-LCL',
          DEBITAMOUNT: 50,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          DOCUMENT: '17176',
          INVOICE: '156',
          VOUCHER: 'V-1',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 477561,
          LINENUMBER: 30,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE:
            '223304|1301|013|001|005|101000554|101000554|Sl-000081|Sl-000081|16454|3042|5013|Collect|||IMPORT||||',
          FINTAGDISPLAYVALUE: 'O26-IMP-OC-80|ME_Q-20260140997-IMP-LCL',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 6,
          CURRENCYCODE: 'EGP',
          DOCUMENT: '17176',
          INVOICE: '156',
          VOUCHER: 'V-1',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 477561,
          LINENUMBER: 40,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Petty cash',
          ACCOUNTDISPLAYVALUE: 'PSD EG',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 144,
          CURRENCYCODE: 'EGP',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
      ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

      const dfoLines = (processor as any).buildLines('477561', rawLines);
      const withholdingLine = dfoLines.find((line: any) =>
        String(line.OffsetAccountDisplayValue ?? '').startsWith('223304'),
      );
      // Companion uses the shape-matched vendor; withholding is still allocated
      // across every same-invoice vendor so Petty Cash stays at 144.
      expect(withholdingLine).toMatchObject({
        AccountDisplayValue: 'Sl-000081',
        DebitAmount: 6,
        OffsetAccountType: 'Ledger',
      });
      expect(withholdingLine.FinTagDisplayValue).toContain('O26-IMP-OC-80');

      const paymentTotal = dfoLines
        .filter(
          (line: any) =>
            !String(line.OffsetAccountDisplayValue ?? '').startsWith('223304'),
        )
        .reduce((sum: number, line: any) => sum + Number(line.DebitAmount), 0);
      expect(paymentTotal).toBe(144);
    });

    it('cashout_settel_test UniqueId 477553: Petty Cash + 223304 stay balanced', async () => {
      const processor = createProcessor();
      const workbook = new Workbook();
      await workbook.xlsx.load(
        (await readFile(join(process.cwd(), 'cashout_settel_test.xlsx'))) as any,
      );
      const worksheet = workbook.worksheets[0];
      const headers: string[] = [];
      worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
        headers[col - 1] = String(cell.value ?? '').trim();
      });
      const rawLines = [] as CashEntryRawDataModel[];
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;
        const record: Record<string, unknown> = {};
        headers.forEach((header, index) => {
          record[header] = row.getCell(index + 1).value;
        });
        if (Number(record.UniqueId) !== 477553) return;
        rawLines.push(new CashEntryRawDataModel(record as any, 'Freight'));
      });

      expect(rawLines.length).toBeGreaterThan(3);
      const dfoLines = (processor as any).buildLines('477553', rawLines);
      expect(
        dfoLines.every(
          (line: any) =>
            !Array.isArray(line.GetErrors?.()) || line.GetErrors().length === 0,
        ),
      ).toBe(true);

      const paymentLines = dfoLines.filter(
        (line: any) =>
          !String(line.OffsetAccountDisplayValue ?? '')
            .split('|')[0]
            .startsWith('223304'),
      );
      const withholdingLines = dfoLines.filter((line: any) =>
        String(line.OffsetAccountDisplayValue ?? '')
          .split('|')[0]
          .startsWith('223304'),
      );

      const paymentTotal = paymentLines.reduce(
        (sum: number, line: any) => sum + Number(line.DebitAmount),
        0,
      );
      const withholdingTotal = withholdingLines.reduce(
        (sum: number, line: any) => sum + Number(line.DebitAmount),
        0,
      );

      expect(withholdingLines).toHaveLength(1);
      expect(withholdingTotal).toBe(35.99);
      expect(paymentTotal).toBe(1332);
      expect(paymentTotal + withholdingTotal).toBe(1367.99);
      expect(
        paymentLines.every(
          (line: any) =>
            line.OffsetAccountDisplayValue === 'PSD EG' &&
            line.CreditAmount === 0 &&
            line.AccountDisplayValue === 'Sl-000081',
        ),
      ).toBe(true);
      expect(withholdingLines[0]).toMatchObject({
        AccountType: 'Vend',
        AccountDisplayValue: 'Sl-000081',
        OffsetAccountType: 'Ledger',
        CreditAmount: 0,
      });
      // Payment credit must never be copied onto each vendor line.
      expect(paymentLines.every((line: any) => line.DebitAmount !== 1332)).toBe(
        true,
      );
    });

    it('preserves original vendor amounts for sample UniqueId 466695 shape', () => {
      const processor = createProcessor();
      jest
        .spyOn(processor as any, 'fetchExchangeRates')
        .mockReturnValue({ exchangeRate: 4765, reportingRate: 100 });

      const rawLines = [
        {
          UniqueId: 466695,
          LINENUMBER: 45,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'Sl-000020',
          DEBITAMOUNT: 300,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'USD',
          INVOICE: '2025001409',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 466695,
          LINENUMBER: 46,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Petty cash',
          ACCOUNTDISPLAYVALUE: 'ALEXHO US',
          DEBITAMOUNT: 0,
          CREDITAMOUNT: 555,
          CURRENCYCODE: 'USD',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
        {
          UniqueId: 466695,
          LINENUMBER: 47,
          TRANSDATE: '2026-01-15',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'Sl-000020',
          DEBITAMOUNT: 255,
          CREDITAMOUNT: 0,
          CURRENCYCODE: 'USD',
          INVOICE: '2025011317',
          SafeType: 'Vendor Payment',
          VoucherType: 'Cash',
        },
      ].map((line) => new CashEntryRawDataModel(line as any, 'Freight'));

      const dfoLines = (processor as any).buildLines('466695', rawLines);
      expect(dfoLines).toHaveLength(2);
      expect(dfoLines.map((line: any) => line.DebitAmount).sort()).toEqual([
        255, 300,
      ]);
      expect(
        dfoLines.every(
          (line: any) =>
            line.OffsetAccountDisplayValue === 'ALEXHO US' &&
            line.CreditAmount === 0,
        ),
      ).toBe(true);
      // Payment credit must not overwrite either vendor debit.
      expect(dfoLines.every((line: any) => line.DebitAmount !== 555)).toBe(
        true,
      );
      // Non-WHT: MarkedLines carries the vendor-line invoice only.
      expect(
        dfoLines
          .map((line: any) => line.MarkedLines[0])
          .sort((a: any, b: any) =>
            String(a.InvoiceNumber).localeCompare(String(b.InvoiceNumber)),
          ),
      ).toEqual([
        expect.objectContaining({
          InvoiceNumber: '2025001409',
          HasWithHoldingLine: false,
        }),
        expect.objectContaining({
          InvoiceNumber: '2025011317',
          HasWithHoldingLine: false,
        }),
      ]);
    });
  });
});
