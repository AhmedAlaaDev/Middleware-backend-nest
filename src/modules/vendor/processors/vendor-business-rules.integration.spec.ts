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

describe('Vendor Business Rules Comprehensive Integration Test Suite', () => {
  let processor: TestVendorEntryProcessor;
  let queryBus: jest.Mocked<QueryBus>;
  let commandBus: jest.Mocked<CommandBus>;

  const realUtilsService = new EntryProcessorUtilsService();

  const mockUtilsService = {
    suffixDuplicateInvoices: jest.fn((lines) => lines),
    getDimensionSegmentLength: jest.fn(() => 19),
    parseDimensionString: jest.fn((dimStr: string) => {
      if (!dimStr) return {};
      const parts = dimStr.split('-');
      return {
        mainAccount: parts[0] || '200101',
        costCenter: parts[1] || 'CC01',
        activityName: parts[2] || 'ACT01',
        businessUnit: parts[3] || 'BU01',
        location: parts[4] || 'LOC01',
        customer: parts[5] || 'CUST01',
        subCustomer: parts[6] || 'SUBCUST01',
        vendor: parts[7] || 'VEND01',
        chargeType: parts[8] || 'CHG01',
        salesMan: parts[9] || 'SALES01',
      };
    }),
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
    validateDimensions: jest.fn(),
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

    (processor as any).dimensionsMap = new Map();
    (processor as any).accountNumberSet = new Set();

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

  describe('Rule 1: Universal Vendor Invoice Matching & Missing Invoice Fallback (PBI #2031)', () => {
    it('should set MarkedInvoice = "" and append " - unmarked" to Description for standard vendor with missing invoice', async () => {
      const rawData: any[] = [
        {
          UniqueId: 101,
          LINENUMBER: 1,
          JOURNALBATCHNUMBER: 'B101',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-STD-001',
          DEFAULTDIMENSIONDISPLAYVALUE: '200101-CC01-ACT01-BU01-LOC01-CUST01-SUBCUST01-VEND01-CHG01',
          CREDITAMOUNT: 5000,
          DEBITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          TRANSDATE: '2026-01-20',
          INVOICE: undefined,
        },
      ];

      const result = await processor.formatAndEnrichAsync(rawData, 'mesco');

      expect(result).toHaveLength(1);
      expect(result[0].Invoice).toBe('');
      expect(result[0].MarkedInvoice).toBe('');
      expect(result[0].Description).toBe('Test Vendor Freight Jan 2026 - unmarked');
    });

    it('should set MarkedInvoice = "" and append " - unmarked" to Description for custody vendor with missing invoice', () => {
      const lineRaw: any = {
        UniqueId: 102,
        LINENUMBER: 2,
        JOURNALBATCHNUMBER: 'B101',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'VEND-CUST-001',
        DEFAULTDIMENSIONDISPLAYVALUE: '200101-CC01-ACT01-BU01-LOC01',
        CREDITAMOUNT: 3000,
        DEBITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-20',
        INVOICE: '',
      };

      const builtLine = (processor as any).buildLine('SRC-102', lineRaw);

      expect(builtLine.Invoice).toBe('');
      expect(builtLine.MarkedInvoice).toBe('');
      expect(builtLine.Description).toBe('Test Vendor Freight Jan 2026 - unmarked');
    });
  });

  describe('Rule 2: Partial Payment vs Full Payment MarkedInvoice Handling (PBI #2035)', () => {
    it('should set MarkedInvoice = "" and append " - unmarked" when Payment Amount (400) < Invoice Amount (1000) [Partial Payment]', () => {
      const lineRaw: any = {
        UniqueId: 201,
        LINENUMBER: 1,
        JOURNALBATCHNUMBER: 'B201',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'VEND-PARTIAL',
        DEFAULTDIMENSIONDISPLAYVALUE: '200101-CC01',
        CREDITAMOUNT: 400,
        DEBITAMOUNT: 0,
        INVOICEAMOUNT: 1000,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-20',
        INVOICE: 'INV-2026-PARTIAL',
      };

      const builtLine = (processor as any).buildLine('SRC-201', lineRaw);

      expect(builtLine.Invoice).toBe('INV-2026-PARTIAL');
      expect(builtLine.MarkedInvoice).toBe('');
      expect(builtLine.Description).toBe('Test Vendor Freight Jan 2026 - unmarked');
    });

    it('should retain MarkedInvoice string and normal Description when Payment Amount (1000) >= Invoice Amount (1000) [Full Payment]', () => {
      const lineRaw: any = {
        UniqueId: 202,
        LINENUMBER: 2,
        JOURNALBATCHNUMBER: 'B201',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'VEND-FULL',
        DEFAULTDIMENSIONDISPLAYVALUE: '200101-CC01',
        CREDITAMOUNT: 1000,
        DEBITAMOUNT: 0,
        INVOICEAMOUNT: 1000,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-20',
        INVOICE: 'INV-2026-FULL',
      };

      const builtLine = (processor as any).buildLine('SRC-202', lineRaw);

      expect(builtLine.Invoice).toBe('INV-2026-FULL');
      expect(builtLine.MarkedInvoice).toBe('INV-2026-FULL');
      expect(builtLine.Description).toBe('Test Vendor Freight Jan 2026');
    });

    it('should retain MarkedInvoice string and normal Description when Payment Amount (1200) > Invoice Amount (1000) [Overpayment]', () => {
      const lineRaw: any = {
        UniqueId: 203,
        LINENUMBER: 3,
        JOURNALBATCHNUMBER: 'B201',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'VEND-OVER',
        DEFAULTDIMENSIONDISPLAYVALUE: '200101-CC01',
        CREDITAMOUNT: 1200,
        DEBITAMOUNT: 0,
        INVOICEAMOUNT: 1000,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-20',
        INVOICE: 'INV-2026-OVER',
      };

      const builtLine = (processor as any).buildLine('SRC-203', lineRaw);

      expect(builtLine.Invoice).toBe('INV-2026-OVER');
      expect(builtLine.MarkedInvoice).toBe('INV-2026-OVER');
      expect(builtLine.Description).toBe('Test Vendor Freight Jan 2026');
    });
  });

  describe('Rule 3: 22420 Ledger Tag Dimension Filtering (PBI #2039)', () => {
    it('should drop non-core dimensions for Ledger line where tag/account starts with 22420', () => {
      const lineRaw: any = {
        UniqueId: 301,
        LINENUMBER: 1,
        JOURNALBATCHNUMBER: 'B301',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '224201-CC01-ACT01-BU01-LOC01-CUST01-SUBCUST01-VEND01-CHG01',
        FINTAGDISPLAYVALUE: '224201_TAG',
        CREDITAMOUNT: 0,
        DEBITAMOUNT: 2500,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-20',
      };

      const builtLine = (processor as any).buildLine('SRC-301', lineRaw);

      // Retained allowed dimensions
      expect(builtLine.DimensionModel.mainAccount).toBe('224201');
      expect(builtLine.DimensionModel.costCenter).toBe('CC01');
      expect(builtLine.DimensionModel.activityName).toBe('ACT01');
      expect(builtLine.DimensionModel.businessUnit).toBe('BU01');
      expect(builtLine.DimensionModel.location).toBe('LOC01');
      expect(builtLine.DimensionModel.vendor).toBe('VEND01');

      // Dropped dimensions
      expect(builtLine.DimensionModel.customer).toBeUndefined();
      expect(builtLine.DimensionModel.subCustomer).toBeUndefined();
      expect(builtLine.DimensionModel.chargeType).toBeUndefined();
    });

    it('should NOT drop non-core dimensions for Ledger line with non-22420 tag', () => {
      const lineRaw: any = {
        UniqueId: 302,
        LINENUMBER: 2,
        JOURNALBATCHNUMBER: 'B301',
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '100501-CC01-ACT01-BU01-LOC01-CUST01-SUBCUST01-VEND01-CHG01',
        FINTAGDISPLAYVALUE: '100501_TAG',
        CREDITAMOUNT: 0,
        DEBITAMOUNT: 2500,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-20',
      };

      const builtLine = (processor as any).buildLine('SRC-302', lineRaw);

      expect(builtLine.DimensionModel.customer).toBe('CUST01');
      expect(builtLine.DimensionModel.chargeType).toBe('CHG01');
    });

    it('should NOT drop non-core dimensions for Vend line even if tag starts with 22420', () => {
      const lineRaw: any = {
        UniqueId: 303,
        LINENUMBER: 3,
        JOURNALBATCHNUMBER: 'B301',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'VEND-001',
        DEFAULTDIMENSIONDISPLAYVALUE: '200101-CC01-ACT01-BU01-LOC01-CUST01-SUBCUST01-VEND01-CHG01',
        FINTAGDISPLAYVALUE: '224201_TAG',
        CREDITAMOUNT: 5000,
        DEBITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        TRANSDATE: '2026-01-20',
        INVOICE: 'INV-VEND-22420',
      };

      const builtLine = (processor as any).buildLine('SRC-303', lineRaw);

      expect(builtLine.DimensionModel.customer).toBe('CUST01');
      expect(builtLine.DimensionModel.chargeType).toBe('CHG01');
    });
  });

  describe('Comprehensive Multi-Line Integration Batch Scenario', () => {
    it('should format, enrich, and validate a mixed batch applying all 3 business rules simultaneously', async () => {
      const mixedRawBatch: any[] = [
        // Line 1: Standard vendor with full payment
        {
          UniqueId: 501,
          LINENUMBER: 1,
          JOURNALBATCHNUMBER: 'BATCH-ALL',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-01',
          DEFAULTDIMENSIONDISPLAYVALUE: '200101-CC01-ACT01-BU01-LOC01',
          CREDITAMOUNT: 1000,
          DEBITAMOUNT: 0,
          INVOICEAMOUNT: 1000,
          CURRENCYCODE: 'EGP',
          TRANSDATE: '2026-01-25',
          INVOICE: 'INV-FULL-BATCH',
        },
        // Line 2: Standard vendor with partial payment
        {
          UniqueId: 502,
          LINENUMBER: 2,
          JOURNALBATCHNUMBER: 'BATCH-ALL',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-02',
          DEFAULTDIMENSIONDISPLAYVALUE: '200101-CC01-ACT01-BU01-LOC01',
          CREDITAMOUNT: 300,
          DEBITAMOUNT: 0,
          INVOICEAMOUNT: 1000,
          CURRENCYCODE: 'EGP',
          TRANSDATE: '2026-01-25',
          INVOICE: 'INV-PARTIAL-BATCH',
        },
        // Line 3: Standard vendor with missing invoice
        {
          UniqueId: 503,
          LINENUMBER: 3,
          JOURNALBATCHNUMBER: 'BATCH-ALL',
          ACCOUNTTYPE: 'Vend',
          ACCOUNTDISPLAYVALUE: 'VEND-03',
          DEFAULTDIMENSIONDISPLAYVALUE: '200101-CC01-ACT01-BU01-LOC01',
          CREDITAMOUNT: 500,
          DEBITAMOUNT: 0,
          CURRENCYCODE: 'EGP',
          TRANSDATE: '2026-01-25',
          INVOICE: undefined,
        },
        // Line 4: 22420 Ledger line
        {
          UniqueId: 504,
          LINENUMBER: 4,
          JOURNALBATCHNUMBER: 'BATCH-ALL',
          ACCOUNTTYPE: 'Ledger',
          ACCOUNTDISPLAYVALUE: '224201-CC01-ACT01-BU01-LOC01-CUST01-SUBCUST01-VEND01-CHG01',
          FINTAGDISPLAYVALUE: '224201_TAG',
          CREDITAMOUNT: 0,
          DEBITAMOUNT: 1800,
          CURRENCYCODE: 'EGP',
          TRANSDATE: '2026-01-25',
        },
      ];

      const enrichedLines = await processor.formatAndEnrichAsync(mixedRawBatch, 'mesco');

      expect(enrichedLines).toHaveLength(4);

      const fullPaymentLine = enrichedLines.find((l: any) => l.Invoice === 'INV-FULL-BATCH') as any;
      const partialPaymentLine = enrichedLines.find((l: any) => l.Invoice === 'INV-PARTIAL-BATCH') as any;
      const missingInvoiceLine = enrichedLines.find((l: any) => l.AccountDisplayValue === 'VEND-03') as any;
      const ledger22420Line = enrichedLines.find((l: any) => l.AccountDisplayValue.startsWith('224201')) as any;

      // Line 1: Full Payment
      expect(fullPaymentLine).toBeDefined();
      expect(fullPaymentLine.Invoice).toBe('INV-FULL-BATCH');
      expect(fullPaymentLine.MarkedInvoice).toBe('INV-FULL-BATCH');
      expect(fullPaymentLine.Description).toBe('Test Vendor Freight Jan 2026');

      // Line 2: Partial Payment
      expect(partialPaymentLine).toBeDefined();
      expect(partialPaymentLine.Invoice).toBe('INV-PARTIAL-BATCH');
      expect(partialPaymentLine.MarkedInvoice).toBe('');
      expect(partialPaymentLine.Description).toBe('Test Vendor Freight Jan 2026 - unmarked');

      // Line 3: Missing Invoice
      expect(missingInvoiceLine).toBeDefined();
      expect(missingInvoiceLine.Invoice).toBe('');
      expect(missingInvoiceLine.MarkedInvoice).toBe('');
      expect(missingInvoiceLine.Description).toBe('Test Vendor Freight Jan 2026 - unmarked');

      // Line 4: 22420 Ledger Line
      expect(ledger22420Line).toBeDefined();
      expect(ledger22420Line.DimensionModel.mainAccount).toBe('224201');
      expect(ledger22420Line.DimensionModel.vendor).toBe('VEND01');
      expect(ledger22420Line.DimensionModel.customer).toBeUndefined();
      expect(ledger22420Line.DimensionModel.chargeType).toBeUndefined();

      // Validation Step
      const validatedLines = processor.validateAsync(enrichedLines, 'mesco');
      expect(validatedLines).toHaveLength(4);
    });
  });
});
