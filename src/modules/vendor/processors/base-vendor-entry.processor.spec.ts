import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';
import { BaseVendorEntryProcessor } from '@/modules/vendor/processors/base-vendor-entry.processor';

class TestVendorEntryProcessor extends BaseVendorEntryProcessor {
  readonly entryProcessorType = EntryProcessorTypes.VendorFreight;
  readonly requiredDimensions: RequiredDimensionsConfig = {
    MainAccount: true,
    Customer: false,
    SubCustomer: false,
    Activity: false,
    CostCenters: false,
    BusinessUnit: false,
    Location: false,
    ChargeType: false,
    SalesMan: false,
    FreightType: false,
    CoordinatorMan: false,
    Direction: false,
    Vendor: true,
    SubVendor: false,
  };

  protected getJournalName(): string {
    return 'V-Freight';
  }

  protected getDescriptionPrefix(): string {
    return 'Test Vendor Freight';
  }
}

describe('BaseVendorEntryProcessor - MarkedInvoice Fallback Tests', () => {
  let processor: TestVendorEntryProcessor;
  let queryBus: jest.Mocked<QueryBus>;
  let commandBus: jest.Mocked<CommandBus>;

  const mockUtilsService = {
    suffixDuplicateInvoices: jest.fn((lines) => lines),
    getDimensionSegmentLength: jest.fn(() => 19),
    parseDimensionString: jest.fn(() => ({ mainAccount: '200101' })),
    normalizeCurrencyCode: jest.fn((c) => c || 'EGP'),
    formatMonthYear: jest.fn(() => 'Jan 2026'),
    updateBatchAndVoucher: jest.fn(({ lines }) => lines),
    isValidDimensionSegmentLength: jest.fn(() => true),
    checkInvoiceBalancedAfterFx: jest.fn(() => new Set()),
  };

  const mockDimensionService = {
    buildDimensionsMap: jest.fn().mockResolvedValue(new Map()),
    fetchDimensionValuesMap: jest.fn().mockResolvedValue(new Map()),
  };

  beforeEach(async () => {
    queryBus = { execute: jest.fn().mockResolvedValue({ items: [] }) } as any;
    commandBus = { execute: jest.fn().mockResolvedValue(undefined) } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestVendorEntryProcessor,
        {
          provide: EntryProcessorBaseDependencies,
          useValue: {
            queryBus,
            commandBus,
            utilsService: mockUtilsService,
            dimensionService: mockDimensionService,
          },
        },
        { provide: CommandBus, useValue: commandBus },
      ],
    }).compile();

    processor = module.get<TestVendorEntryProcessor>(TestVendorEntryProcessor);

    jest.spyOn(processor as any, 'warmupProcessorData').mockResolvedValue(undefined);
    jest.spyOn(processor as any, 'fetchExchangeRates').mockReturnValue({
      exchangeRate: 1,
      reportingRate: 1,
    });
    jest
      .spyOn(processor as any, 'getVendorTaxNumberAndTermsOfPayment')
      .mockReturnValue({
        taxNumber: '123456',
        termsOfPayment: 'Net 30',
      });
  });

  it('should populate MarkedInvoice when INVOICE is present on vendor line', async () => {
    const rawData: any[] = [
      {
        UniqueId: 1,
        LINENUMBER: 1,
        JOURNALBATCHNUMBER: 'B100',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'V001',
        DEFAULTDIMENSIONDISPLAYVALUE: '200101-01-02-03',
        CREDITAMOUNT: 1000,
        DEBITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-15',
        INVOICE: 'INV-2026-001',
      },
    ];

    const result = await processor.formatAndEnrichAsync(rawData, 'mesco');

    expect(result).toHaveLength(1);
    expect(result[0].Invoice).toBe('INV-2026-001');
    expect(result[0].MarkedInvoice).toBe('INV-2026-001');
  });

  it('should default MarkedInvoice to empty string "" for regular vendors when INVOICE is missing', async () => {
    const rawData: any[] = [
      {
        UniqueId: 2,
        LINENUMBER: 2,
        JOURNALBATCHNUMBER: 'B100',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'V002',
        DEFAULTDIMENSIONDISPLAYVALUE: '200101-01-02-03',
        CREDITAMOUNT: 500,
        DEBITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-15',
        INVOICE: undefined,
      },
    ];

    const result = await processor.formatAndEnrichAsync(rawData, 'mesco');

    expect(result).toHaveLength(1);
    expect(result[0].Invoice).toBe('');
    expect(result[0].MarkedInvoice).toBe('');
  });

  it('should safely build single line with empty string MarkedInvoice when invoice is missing', () => {
    const lineRaw: any = {
      UniqueId: 3,
      LINENUMBER: 3,
      JOURNALBATCHNUMBER: 'B100',
      ACCOUNTTYPE: 'Vend',
      ACCOUNTDISPLAYVALUE: 'V003',
      DEFAULTDIMENSIONDISPLAYVALUE: '200101-01-02-03',
      CREDITAMOUNT: 750,
      DEBITAMOUNT: 0,
      CURRENCYCODE: 'EGP',
      TRANSDATE: '2026-01-15',
      INVOICE: '',
    };

    const builtLine = (processor as any).buildLine('SRC-3', lineRaw);

    expect(builtLine.Invoice).toBe('');
    expect(builtLine.MarkedInvoice).toBe('');
  });
});
