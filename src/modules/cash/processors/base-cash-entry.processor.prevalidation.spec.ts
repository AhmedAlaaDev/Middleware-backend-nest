import { BadRequestException } from '@nestjs/common';

import { CashEntryRawDataModel } from '@/modules/cash/models';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/cash-out-freight-entry.processor';
import {
  CustodySettlementTarget,
  GeneralJournalService,
} from '@/modules/d365fo/services/general-journal.service';
import { VendorInvoiceJournalService } from '@/modules/d365fo/services/vendor-invoice-journal.service';
import { EntryProcessorUtilsService } from '@/modules/entry-processor/services/entry-processor-utils.service';
import { DimensionKey } from '@/modules/entry-processor/types';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

describe('BaseCashEntryProcessor - PBI 2066 pre-format validation', () => {
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

  const createProcessor = (options?: {
    custodyAccounts?: string[];
    existingPairs?: Set<string>;
    custodyMatches?: Map<string, any[]>;
  }) => {
    const vendorInvoiceJournalService = {
      findExistingInvoiceVendorPairs: jest
        .fn()
        .mockResolvedValue(options?.existingPairs ?? new Set()),
    };
    const generalJournalService = {
      findCustodySettlementTargets: jest
        .fn()
        .mockResolvedValue(options?.custodyMatches ?? new Map()),
    };
    const processor = new CashOutFreightEntryProcessor(
      { execute: jest.fn() } as any,
      {
        queryBus: {
          execute: jest.fn().mockResolvedValue({
            items: (options?.custodyAccounts ?? []).map(
              (vendorAccountNumber) => ({ vendorAccountNumber }),
            ),
          }),
        },
        exchangeRateService: {},
        utilsService: new EntryProcessorUtilsService(),
        dimensionService: new DimensionValidationService(),
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService,
        cashOutExchangeRateService: {},
        generalJournalService,
      } as any,
    );
    (processor as any).company = 'm-p';
    (processor as any).dimensionsMap = new Map(
      dimensionKeys.map((key) => [key, new Set<string>()]),
    );
    (processor as any).accountNumberSet = new Set<string>();
    return { processor, vendorInvoiceJournalService, generalJournalService };
  };

  const vendorPaymentLines = (vendor = 'V-001') =>
    [
      {
        UniqueId: 2066,
        LINENUMBER: 1,
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: vendor,
        DEBITAMOUNT: 100,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        DOCUMENT: 'DOC-2066',
        INVOICE: 'INV-2066',
        FINTAGDISPLAYVALUE: 'OP-2066|Q-1',
        SafeType: 'Vendor Payment',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 2066,
        LINENUMBER: 2,
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'BANK-1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 100,
        CURRENCYCODE: 'EGP',
        SafeType: 'Vendor Payment',
        VoucherType: 'Cash',
      },
    ].map((line) => new CashEntryRawDataModel(line as any, 'Freight', false));

  it('blocks a normal Vendor Payment when its invoice/vendor pair is missing', async () => {
    const { processor } = createProcessor();
    jest
      .spyOn(processor as any, 'collectSourceDimensionErrors')
      .mockImplementation(() => undefined);

    await expect(
      (processor as any).validateCashOutSourceAsync(vendorPaymentLines()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a normal Vendor Payment when its invoice belongs to the vendor', async () => {
    const pair = VendorInvoiceJournalService.pairKey('INV-2066', 'V-001');
    const { processor } = createProcessor({
      existingPairs: new Set([pair]),
    });
    jest
      .spyOn(processor as any, 'collectSourceDimensionErrors')
      .mockImplementation(() => undefined);

    await expect(
      (processor as any).validateCashOutSourceAsync(vendorPaymentLines()),
    ).resolves.toBeUndefined();
  });

  it('validates a custody vendor against exactly one ledger target', async () => {
    const target: CustodySettlementTarget = {
      documentNumber: 'DOC-2066',
      currency: 'EGP',
      amount: 100,
      operationNumber: 'OP-2066',
    };
    const key = GeneralJournalService.custodySettlementTargetKey(target);
    const { processor } = createProcessor({
      custodyAccounts: ['CUSTODY-1'],
      custodyMatches: new Map([
        [key, [{ Invoice: 'CUSTODY-TARGET-1', Document: 'DOC-2066' }]],
      ]),
    });
    jest
      .spyOn(processor as any, 'collectSourceDimensionErrors')
      .mockImplementation(() => undefined);
    const lines = vendorPaymentLines('CUSTODY-1');

    await expect(
      (processor as any).validateCashOutSourceAsync(lines),
    ).resolves.toBeUndefined();
    expect(lines[0].IsCustodyVendor).toBe(true);
    expect(lines[0].MARKEDINVOICE).toBe('CUSTODY-TARGET-1');
  });

  it('preserves multiple resolved custody ledger markings through formatting', async () => {
    const targets: CustodySettlementTarget[] = [
      {
        documentNumber: 'DOC-CUSTODY-1',
        currency: 'EGP',
        amount: 60,
        operationNumber: 'OP-CUSTODY-1',
      },
      {
        documentNumber: 'DOC-CUSTODY-2',
        currency: 'EGP',
        amount: 40,
        operationNumber: 'OP-CUSTODY-2',
      },
    ];
    const custodyMatches = new Map([
      [
        GeneralJournalService.custodySettlementTargetKey(targets[0]),
        [{ Voucher: 'CUSTODY-VCH-1', Document: 'DOC-CUSTODY-1' }],
      ],
      [
        GeneralJournalService.custodySettlementTargetKey(targets[1]),
        [{ Voucher: 'CUSTODY-VCH-2', Document: 'DOC-CUSTODY-2' }],
      ],
    ]);
    const { processor } = createProcessor({
      custodyAccounts: ['CUSTODY-1'],
      custodyMatches,
    });
    jest
      .spyOn(processor as any, 'collectSourceDimensionErrors')
      .mockImplementation(() => undefined);
    jest.spyOn(processor as any, 'fetchExchangeRates').mockReturnValue({
      exchangeRate: 1,
      reportingRate: 1,
    });
    (processor as any).vendorNameMap = new Map();

    const lines = [
      {
        UniqueId: 2067,
        LINENUMBER: 1,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'CUSTODY-1',
        DEBITAMOUNT: 60,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        DOCUMENT: 'DOC-CUSTODY-1',
        FINTAGDISPLAYVALUE: 'OP-CUSTODY-1|TAG',
        SafeType: 'Vendor Payment',
        VoucherType: 'Transfer',
      },
      {
        UniqueId: 2067,
        LINENUMBER: 2,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'CUSTODY-1',
        DEBITAMOUNT: 40,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        DOCUMENT: 'DOC-CUSTODY-2',
        FINTAGDISPLAYVALUE: 'OP-CUSTODY-2|TAG',
        SafeType: 'Vendor Payment',
        VoucherType: 'Transfer',
      },
      {
        UniqueId: 2067,
        LINENUMBER: 3,
        TRANSDATE: '2026-01-15',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'BANK-1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 100,
        CURRENCYCODE: 'EGP',
        SafeType: 'Vendor Payment',
        VoucherType: 'Transfer',
      },
    ].map((line) => new CashEntryRawDataModel(line as any, 'Freight', false));

    await expect(
      (processor as any).validateCashOutSourceAsync(lines),
    ).resolves.toBeUndefined();

    const formatted = (processor as any).buildLines('2067', lines);
    expect(formatted).toHaveLength(2);
    expect(formatted.map((line: any) => line.MarkedInvoice)).toEqual([
      'CUSTODY-VCH-1',
      'CUSTODY-VCH-2',
    ]);
    expect(
      formatted.every(
        (line: any) => line.SettlementTargetType === 'CustodyLedger',
      ),
    ).toBe(true);
  });

  it('blocks custody marking when the ledger lookup is ambiguous', async () => {
    const target: CustodySettlementTarget = {
      documentNumber: 'DOC-2066',
      currency: 'EGP',
      amount: 100,
      operationNumber: 'OP-2066',
    };
    const key = GeneralJournalService.custodySettlementTargetKey(target);
    const { processor } = createProcessor({
      custodyAccounts: ['CUSTODY-1'],
      custodyMatches: new Map([[key, [{}, {}]]]),
    });
    jest
      .spyOn(processor as any, 'collectSourceDimensionErrors')
      .mockImplementation(() => undefined);

    await expect(
      (processor as any).validateCashOutSourceAsync(
        vendorPaymentLines('CUSTODY-1'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates supplied optional dimensions but allows empty optional values', async () => {
    const { processor } = createProcessor();
    const invalid = new CashEntryRawDataModel(
      {
        UniqueId: 1,
        LINENUMBER: 1,
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '999999|||||||||||||||||||',
        DEBITAMOUNT: 10,
        SafeType: 'Direct',
      } as any,
      'Freight',
      false,
    );

    await expect(
      (processor as any).validateCashOutSourceAsync([invalid]),
    ).rejects.toBeInstanceOf(BadRequestException);

    (processor as any).accountNumberSet = new Set(['223201']);
    const valid = new CashEntryRawDataModel(
      {
        UniqueId: 2,
        LINENUMBER: 2,
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '223201|||||||||||||||||||',
        CREDITAMOUNT: 10,
        SafeType: 'Direct',
      } as any,
      'Freight',
      false,
    );

    await expect(
      (processor as any).validateCashOutSourceAsync([valid]),
    ).resolves.toBeUndefined();
  });
});
