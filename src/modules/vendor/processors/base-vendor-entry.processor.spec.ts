import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
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

describe('BaseVendorEntryProcessor - MarkedInvoice Fallback & 22420 Tag Tests', () => {
  let processor: TestVendorEntryProcessor;
  let queryBus: jest.Mocked<QueryBus>;
  let commandBus: jest.Mocked<CommandBus>;

  const realUtilsService = new EntryProcessorUtilsService();

  const mockUtilsService = {
    suffixDuplicateInvoices: jest.fn((lines) => lines),
    getDimensionSegmentLength: jest.fn(() => 19),
    parseDimensionString: jest.fn(() => ({
      mainAccount: '224201',
      costCenter: 'CC01',
      activityName: 'ACT01',
      businessUnit: 'BU01',
      location: 'LOC01',
      customer: 'CUST01',
      vendor: 'VEND01',
      chargeType: 'CHG01',
    })),
    filterDimensionsForLedgerTag22420: jest.fn((dims) =>
      realUtilsService.filterDimensionsForLedgerTag22420(dims),
    ),
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
    expect(result[0].Description).toBe('Test Vendor Freight Jan 2026');
  });

  it('should default MarkedInvoice to empty string "" and append "- unmarked" to Description when INVOICE is missing', async () => {
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
    expect(result[0].Description).toContain('unmarked');
  });

  it('should set MarkedInvoice to empty string "" and append "- unmarked" to Description for Partial Payment', () => {
    const lineRaw: any = {
      UniqueId: 3,
      LINENUMBER: 3,
      JOURNALBATCHNUMBER: 'B100',
      ACCOUNTTYPE: 'Vend',
      ACCOUNTDISPLAYVALUE: 'V003',
      DEFAULTDIMENSIONDISPLAYVALUE: '200101-01-02-03',
      CREDITAMOUNT: 400, // Payment amount: 400
      DEBITAMOUNT: 0,
      INVOICEAMOUNT: 1000, // Invoice amount: 1000
      CURRENCYCODE: 'EGP',
      TRANSDATE: '2026-01-15',
      INVOICE: 'INV-2026-PARTIAL',
    };

    const builtLine = (processor as any).buildLine('SRC-3', lineRaw);

    expect(builtLine.Invoice).toBe('INV-2026-PARTIAL');
    expect(builtLine.MarkedInvoice).toBe('');
    expect(builtLine.Description).toBe('Test Vendor Freight Jan 2026 - unmarked');
  });

  it('should retain MarkedInvoice string and normal Description for Full / Over Payment', () => {
    const lineRaw: any = {
      UniqueId: 4,
      LINENUMBER: 4,
      JOURNALBATCHNUMBER: 'B100',
      ACCOUNTTYPE: 'Vend',
      ACCOUNTDISPLAYVALUE: 'V004',
      DEFAULTDIMENSIONDISPLAYVALUE: '200101-01-02-03',
      CREDITAMOUNT: 1000, // Payment amount: 1000
      DEBITAMOUNT: 0,
      INVOICEAMOUNT: 1000, // Invoice amount: 1000
      CURRENCYCODE: 'EGP',
      TRANSDATE: '2026-01-15',
      INVOICE: 'INV-2026-FULL',
    };

    const builtLine = (processor as any).buildLine('SRC-4', lineRaw);

    expect(builtLine.Invoice).toBe('INV-2026-FULL');
    expect(builtLine.MarkedInvoice).toBe('INV-2026-FULL');
    expect(builtLine.Description).toBe('Test Vendor Freight Jan 2026');
  });

  it('should drop non-core dimensions for Ledger line where tag/account starts with 22420', () => {
    const lineRaw: any = {
      UniqueId: 5,
      LINENUMBER: 5,
      JOURNALBATCHNUMBER: 'B100',
      ACCOUNTTYPE: 'Ledger',
      ACCOUNTDISPLAYVALUE: '224201-01',
      // The task trigger is tag OR account. Keep a non-22420 tag to cover
      // the account-only branch used by the real Cash-Out data.
      FINTAGDISPLAYVALUE: 'O25-EXP-OC-12574',
      CREDITAMOUNT: 0,
      DEBITAMOUNT: 2000,
      CURRENCYCODE: 'EGP',
      TRANSDATE: '2026-01-15',
    };

    const builtLine = (processor as any).buildLine('SRC-5', lineRaw);

    // Retained core dimensions
    expect(builtLine.DimensionModel.mainAccount).toBe('224201');
    expect(builtLine.DimensionModel.costCenter).toBe('CC01');
    expect(builtLine.DimensionModel.activityName).toBe('ACT01');
    expect(builtLine.DimensionModel.businessUnit).toBe('BU01');
    expect(builtLine.DimensionModel.location).toBe('LOC01');
    expect(builtLine.DimensionModel.vendor).toBe('VEND01');

    // Dropped non-core dimensions
    expect(builtLine.DimensionModel.customer).toBeUndefined();
    expect(builtLine.DimensionModel.chargeType).toBeUndefined();
    expect(builtLine.DimensionModel.freightType).toBeUndefined();
  });
});
