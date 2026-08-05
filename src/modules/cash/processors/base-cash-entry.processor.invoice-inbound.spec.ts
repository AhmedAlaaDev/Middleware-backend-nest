import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashInFreightEntryProcessor } from '@/modules/cash/processors/cash-in-freight-entry.processor';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('Cash-In free-text invoice normalization', () => {
  const createProcessor = () => {
    const processor = new CashInFreightEntryProcessor(
      { execute: jest.fn() } as any,
      {
        queryBus: { execute: jest.fn() },
        exchangeRateService: {},
        utilsService: new EntryProcessorUtilsService(),
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
    jest.spyOn(processor as any, 'validateDimensionsForLine').mockImplementation(() => undefined);
    return processor;
  };

  describe('formatInvoiceInbound', () => {
    it('strips comma-glued secondary numbers so FO FreeTextNumber can match', () => {
      const processor = createProcessor();

      expect(
        (processor as any).formatInvoiceInbound('8898/OR-TR,8932'),
      ).toBe('000008898/OR-TR');
      expect(
        (processor as any).formatInvoiceInbound(
          '000008020/OR-FW,000008207',
        ),
      ).toBe('000008020/OR-FW');
      expect(
        (processor as any).formatInvoiceInbound(
          '000005037/OF-FW,000005152',
        ),
      ).toBe('000005037/OF-FW');
    });

    it('clears DRAFT document fallbacks that are not FreeTextInvoiceHeaders', () => {
      const processor = createProcessor();

      expect((processor as any).formatInvoiceInbound('31906/DRAFT')).toBe(
        '',
      );
      expect((processor as any).formatInvoiceInbound('000031906/draft')).toBe(
        '',
      );
    });

    it('still normalizes Arabic freight text to OF-FW', () => {
      const processor = createProcessor();

      expect(
        (processor as any).formatInvoiceInbound(
          '5564/مطالبة نولون محصلة لصالح الغير',
        ),
      ).toBe('000005564/OF-FW');
    });
  });

  describe('validateAsync', () => {
    it('looks up the normalized FreeTextNumber without comma junk', () => {
      const processor = createProcessor();
      (processor as any).freeTextInvoiceMap = new Map([
        [
          '000008898/or-tr',
          [{ invoiceNumber: '000008898/OR-TR', exists: true, isPosted: true }],
        ],
      ]);

      const line = new CashEntryDynDataModel(null, {
        SourceIds: ['468229'],
        MarkedInvoice: '000008898/OR-TR',
        Invoice: '000008898/OR-TR',
        AccountType: 'Cust',
      } as any);

      const [validated] = processor.validateAsync([line]);
      expect(validated.ErrorCount).toBe(0);
    });

    it('allows unmarked cash-in when MarkedInvoice was cleared (DRAFT / blank)', () => {
      const processor = createProcessor();
      (processor as any).freeTextInvoiceMap = new Map();

      const line = new CashEntryDynDataModel(null, {
        SourceIds: ['466653'],
        MarkedInvoice: '',
        Invoice: '',
        AccountType: 'Cust',
      } as any);

      const [validated] = processor.validateAsync([line]);
      expect(validated.ErrorCount).toBe(0);
      expect(validated.GetErrors()).toEqual([]);
    });

    it('still errors when a real FreeTextNumber is missing in FO', () => {
      const processor = createProcessor();
      (processor as any).freeTextInvoiceMap = new Map();

      const line = new CashEntryDynDataModel(null, {
        SourceIds: ['1'],
        MarkedInvoice: '000008898/OR-TR',
        Invoice: '000008898/OR-TR',
        AccountType: 'Cust',
      } as any);

      const [validated] = processor.validateAsync([line]);
      expect(validated.ErrorCount).toBeGreaterThan(0);
      expect(validated.GetErrors()[0]).toContain('not exists in D365FO');
    });
  });
});
