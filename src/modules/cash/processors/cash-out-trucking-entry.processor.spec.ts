import { BadRequestException } from '@nestjs/common';

import { CashEntryRawDataModel } from '@/modules/cash/models';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/cash-out-freight-entry.processor';
import { CashOutTruckingEntryProcessor } from '@/modules/cash/processors/cash-out-trucking-entry.processor';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionKey } from '@/modules/entry-processor/types';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('CashOutTruckingEntryProcessor - Fleet Worker dimensions', () => {
  const dimensionKeys: DimensionKey[] = [
    'Activity',
    'CostCenters',
    'BusinessUnit',
    'Location',
    'Customer',
    'SubCustomer',
    'Vendor',
    'SubVendor',
    'ChargeType',
    'SalesMan',
    'CoordinatorMan',
    'FreightType',
    'Direction',
    'TruckerType',
    'TruckNumber',
    'Worker',
  ];

  const fleetWorkerLine = () =>
    new CashEntryRawDataModel(
      {
        UniqueId: 226668,
        LINENUMBER: 549,
        ACCOUNTTYPE: 'Ledger',
        // Real Fleet Cash-Out WHT line from batch 6a71fc26… — Worker 2753 is
        // present but not always synced in master data.
        ACCOUNTDISPLAYVALUE:
          '223404|2101|021|002|001|101000838|101000838|3012|3012|744|2524|3345|Payable|12|H10|DOMESTIC|2753|||',
        DEBITAMOUNT: 10,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        SafeType: 'Direct',
        VoucherType: 'Cash',
      } as any,
      'Fleet',
      false,
    );

  const createProcessor = (target: 'Freight' | 'Fleet') => {
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
        vendorInvoiceJournalService: {
          findExistingInvoiceVendorPairs: jest
            .fn()
            .mockResolvedValue(new Set()),
        },
        cashOutExchangeRateService: {},
        generalJournalService: {
          findCustodySettlementTargets: jest.fn().mockResolvedValue(new Map()),
        },
      } as any,
    );
    (processor as any).company = 'm-p';

    // All segments from the sample Fleet line except Worker (2753).
    const knownValues = new Set(
      [
        '2101',
        '021',
        '002',
        '001',
        '101000838',
        '3012',
        '744',
        '2524',
        '3345',
        'Payable',
        '12',
        'H10',
        'DOMESTIC',
      ].map((value) => value.toLowerCase()),
    );
    (processor as any).dimensionsMap = new Map(
      dimensionKeys.map((key) => [
        key,
        key === 'Worker' ? new Set<string>() : knownValues,
      ]),
    );
    (processor as any).accountNumberSet = new Set(['223404']);
    return processor;
  };

  it('does not block Cash-Out Fleet format when Worker is present but unknown', async () => {
    const processor = createProcessor('Fleet');

    await expect(
      (processor as any).validateCashOutSourceAsync([fleetWorkerLine()]),
    ).resolves.toBeUndefined();

    expect(processor.requiredDimensions).not.toHaveProperty('Worker');
  });

  it('still validates Worker for Cash-Out Freight when the value is present', async () => {
    const processor = createProcessor('Freight');
    const line = new CashEntryRawDataModel(
      {
        UniqueId: 226668,
        LINENUMBER: 549,
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE:
          '223404|2101|021|002|001|101000838|101000838|3012|3012|744|2524|3345|Payable|12|H10|DOMESTIC|2753|||',
        DEBITAMOUNT: 10,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        SafeType: 'Direct',
        VoucherType: 'Cash',
      } as any,
      'Freight',
      false,
    );

    await expect(
      (processor as any).validateCashOutSourceAsync([line]),
    ).rejects.toBeInstanceOf(BadRequestException);

    try {
      await (processor as any).validateCashOutSourceAsync([line]);
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as {
        errors?: string[];
      };
      expect(response.errors?.[0]).toContain('Worker');
      expect(response.errors?.[0]).toContain('2753');
    }
  });
});
