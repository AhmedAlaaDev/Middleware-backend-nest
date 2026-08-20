import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashInFreightEntryProcessor } from '@/modules/cash/processors/inbound/freight/cash-in-freight-entry.processor';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

describe('Cash-In: invoice is optional when the source file has no invoice reference', () => {
  const createProcessor = (freeTextEntries: Map<string, any[]>) => {
    const processor = new CashInFreightEntryProcessor(
      { execute: jest.fn() } as any,
      {
        queryBus: { execute: jest.fn() },
        exchangeRateService: {},
        utilsService: {},
        dimensionService: {},
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService: {},
      } as any,
    );

    (processor as any).company = 'm-p';
    (processor as any).freeTextInvoiceMap = freeTextEntries;
    // Dimension completeness is a separate concern from invoice validation;
    // isolate this test from it.
    jest
      .spyOn(processor as any, 'validateDimensionsForLine')
      .mockImplementation(() => undefined);

    return processor;
  };

  const line = (overrides: Partial<CashEntryDynDataModel>) =>
    new CashEntryDynDataModel(new EntryDimensionsModel(), {
      SourceIds: ['1'],
      AccountType: 'Cust',
      OffsetAccountType: 'Bank',
      ...overrides,
    });

  it('does not flag a line whose source row has no INVOICE/DOCUMENT column at all', () => {
    const processor = createProcessor(new Map());
    // Mirrors the real-world template: MarkedInvoice/Invoice both resolve to
    // '' because INVOICE and DOCUMENT are entirely absent from the sheet.
    const [validated] = processor.validateAsync([
      line({ MarkedInvoice: '', Invoice: '' }),
    ]) as CashEntryDynDataModel[];

    expect(validated.GetErrors().some((e) => e.startsWith('Invoice:'))).toBe(
      false,
    );
  });

  it('still flags a provided invoice that does not exist in D365FO', () => {
    const processor = createProcessor(new Map());
    const [validated] = processor.validateAsync([
      line({
        MarkedInvoice: '000012345/INVOICE',
        Invoice: '000012345/INVOICE',
      }),
    ]) as CashEntryDynDataModel[];

    expect(validated.GetErrors()).toContain(
      'Invoice: Free text invoice (000012345/INVOICE) not exists in D365FO',
    );
  });

  it('still flags a provided invoice that exists but is not posted', () => {
    const processor = createProcessor(
      new Map([['000012345/invoice', [{ isPosted: false }]]]),
    );
    const [validated] = processor.validateAsync([
      line({
        MarkedInvoice: '000012345/INVOICE',
        Invoice: '000012345/INVOICE',
      }),
    ]) as CashEntryDynDataModel[];

    expect(validated.GetErrors()).toContain(
      'Invoice: (000012345/INVOICE) exists in D365FO but is not posted (IsPosted=No)',
    );
  });

  it('passes a provided invoice that exists and is posted', () => {
    const processor = createProcessor(
      new Map([['000012345/invoice', [{ isPosted: true }]]]),
    );
    const [validated] = processor.validateAsync([
      line({
        MarkedInvoice: '000012345/INVOICE',
        Invoice: '000012345/INVOICE',
      }),
    ]) as CashEntryDynDataModel[];

    expect(validated.GetErrors().some((e) => e.startsWith('Invoice:'))).toBe(
      false,
    );
  });

  it('handles a mixed batch: missing invoices pass, a bad one still fails', () => {
    const processor = createProcessor(
      new Map([['000012345/invoice', [{ isPosted: true }]]]),
    );
    const lines = [
      line({ SourceIds: ['1'], MarkedInvoice: '', Invoice: '' }),
      line({
        SourceIds: ['2'],
        MarkedInvoice: '000012345/INVOICE',
        Invoice: '000012345/INVOICE',
      }),
      line({
        SourceIds: ['3'],
        MarkedInvoice: '999999999/INVOICE',
        Invoice: '999999999/INVOICE',
      }),
    ];

    const [noInvoice, validInvoice, badInvoice] = processor.validateAsync(
      lines,
    ) as CashEntryDynDataModel[];

    expect(noInvoice.GetErrors().some((e) => e.startsWith('Invoice:'))).toBe(
      false,
    );
    expect(validInvoice.GetErrors().some((e) => e.startsWith('Invoice:'))).toBe(
      false,
    );
    expect(badInvoice.GetErrors()).toContain(
      'Invoice: Free text invoice (999999999/INVOICE) not exists in D365FO',
    );
  });
});
