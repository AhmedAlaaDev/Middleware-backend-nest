import { BadRequestException } from '@nestjs/common';

import { CashEntryRawDataModel } from '@/modules/cash/models';
import { CashOutFreightEntryProcessor } from '@/modules/cash/processors/outbound/freight/cash-out-freight-entry.processor';
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
    const custodyAccounts = new Set(options?.custodyAccounts ?? []);
    const existingPairs = options?.existingPairs ?? new Set();
    const vendorInvoiceJournalService = {
      findExistingInvoiceVendorPairs: jest
        .fn()
        .mockResolvedValue(existingPairs),
      findInvoiceSettlementSnapshots: jest
        .fn()
        .mockImplementation((_company: string, requests: any[]) => {
          const map = new Map();
          for (const req of requests) {
            const pairKey = VendorInvoiceJournalService.pairKey(
              req.invoice,
              req.vendorAccount,
            );
            const exists = existingPairs.has(pairKey);
            map.set(pairKey, {
              company: _company,
              invoice: req.invoice,
              vendorAccount: req.vendorAccount,
              exists,
              invoiceExistsAcrossVendors: exists,
              belongsToVendor: exists,
            });
          }
          return Promise.resolve(map);
        }),
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
          execute: jest.fn().mockImplementation((query) =>
            Promise.resolve({
              items: (query?.filter?.accountNumbers ?? []).map(
                (vendorAccountNumber: string) => ({
                  vendorAccountNumber,
                  vendorGroupId: custodyAccounts.has(vendorAccountNumber)
                    ? 'Custody'
                    : 'Trade',
                }),
              ),
            }),
          ),
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

  it('validates repeated source rows against the aggregate D365 invoice amount', async () => {
    const pair = VendorInvoiceJournalService.pairKey('emp_2', 'Su-000093');
    const { processor, vendorInvoiceJournalService } = createProcessor({
      existingPairs: new Set([pair]),
    });
    vendorInvoiceJournalService.findInvoiceSettlementSnapshots.mockResolvedValue(
      new Map([
        [
          pair,
          {
            company: 'm-p',
            invoice: 'emp_2',
            vendorAccount: 'Su-000093',
            exists: true,
            belongsToVendor: true,
            isOpen: true,
            originalAmount: 4505.04,
            remainingAmount: 4505.04,
            candidateTransactions: [
              {
                vendorAccount: 'Su-000093',
                documentNumber: '20026',
                invoiceNumber: 'emp_2',
                currencyCode: 'EGP',
                originalAmount: 4505.04,
                openAmount: 4505.04,
                isOpen: true,
              },
            ],
          },
        ],
      ]),
    );
    jest
      .spyOn(processor as any, 'collectSourceDimensionErrors')
      .mockImplementation(() => undefined);

    const lines = [
      ...Array.from({ length: 8 }, (_, index) => ({
        UniqueId: 503378,
        LINENUMBER: 18714 + index,
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'Su-000093',
        DEBITAMOUNT: 563.13,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        DOCUMENT: '20026',
        INVOICE: 'emp_2',
        FINTAGDISPLAYVALUE: 'O26-IMP-OC-1500|Q-1',
        SafeType: 'Vendor Payment',
        VoucherType: 'Cash',
      })),
      {
        UniqueId: 503378,
        LINENUMBER: 18722,
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'BANK-1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 4505.04,
        CURRENCYCODE: 'EGP',
        SafeType: 'Vendor Payment',
        VoucherType: 'Cash',
      },
    ].map(
      (sourceLine) =>
        new CashEntryRawDataModel(sourceLine as any, 'Freight', false),
    );

    await expect(
      (processor as any).validateCashOutSourceAsync(lines),
    ).resolves.toBeUndefined();
  });

  it('replaces an accepted source invoice variant with the exact D365 invoice before formatting', async () => {
    const sourcePair = VendorInvoiceJournalService.pairKey('050', 'RP-000003');
    const { processor, vendorInvoiceJournalService } = createProcessor({
      existingPairs: new Set([sourcePair]),
    });
    vendorInvoiceJournalService.findInvoiceSettlementSnapshots.mockResolvedValue(
      new Map([
        [
          sourcePair,
          {
            company: 'm-p',
            invoice: '050-1',
            vendorAccount: 'RP-000003',
            exists: true,
            belongsToVendor: true,
            candidateTransactions: [
              {
                vendorAccount: 'RP-000003',
                documentNumber: '15473',
                invoiceNumber: '050-1',
                currencyCode: 'EGP',
                originalAmount: 9322.54,
                openAmount: 9322.54,
                isOpen: true,
              },
            ],
          },
        ],
      ]),
    );
    jest
      .spyOn(processor as any, 'collectSourceDimensionErrors')
      .mockImplementation(() => undefined);

    const lines = vendorPaymentLines('RP-000003');
    lines[0].INVOICE = '050';
    lines[0].DOCUMENT = '15473';
    lines[0].DEBITAMOUNT = 9322.54;
    lines[1].CREDITAMOUNT = 9322.54;

    await expect(
      (processor as any).validateCashOutSourceAsync(lines),
    ).resolves.toBeUndefined();
    expect(lines[0].MARKEDINVOICE).toBe('050-1');
  });

  it('preserves the exact whitespace-bearing D365 invoice for MarkedLines posting', async () => {
    const sourcePair = VendorInvoiceJournalService.pairKey(
      'GDY_FV000005995',
      'Ag-000194',
    );
    const { processor, vendorInvoiceJournalService } = createProcessor({
      existingPairs: new Set([sourcePair]),
    });
    vendorInvoiceJournalService.findInvoiceSettlementSnapshots.mockResolvedValue(
      new Map([
        [
          sourcePair,
          {
            company: 'm-p',
            invoice: ' GDY_FV000005995',
            vendorAccount: 'Ag-000194',
            exists: true,
            belongsToVendor: true,
            candidateTransactions: [
              {
                vendorAccount: 'Ag-000194',
                documentNumber: '17728',
                invoiceNumber: ' GDY_FV000005995',
                currencyCode: 'EUR',
                originalAmount: 6076.44,
                openAmount: 6076.44,
                isOpen: true,
              },
            ],
          },
        ],
      ]),
    );
    jest
      .spyOn(processor as any, 'collectSourceDimensionErrors')
      .mockImplementation(() => undefined);

    const lines = vendorPaymentLines('Ag-000194');
    lines[0].INVOICE = 'GDY_FV000005995 ';
    lines[0].DOCUMENT = '17728';
    lines[0].CURRENCYCODE = 'EUR';
    lines[0].DEBITAMOUNT = 6076.44;
    lines[1].CURRENCYCODE = 'EUR';
    lines[1].CREDITAMOUNT = 6076.44;

    await expect(
      (processor as any).validateCashOutSourceAsync(lines),
    ).resolves.toBeUndefined();
    expect(lines[0].MARKEDINVOICE).toBe('GDY_FV000005995');
    expect(lines[0].ResolvedD365InvoiceNumber).toBe(' GDY_FV000005995');

    jest.spyOn(processor as any, 'fetchExchangeRates').mockReturnValue({
      exchangeRate: 1,
      reportingRate: 1,
    });
    (processor as any).vendorNameMap = new Map();
    const formatted = (processor as any).buildLines('2066', lines);
    expect(formatted[0].MarkedLines[0].InvoiceNumber).toBe(' GDY_FV000005995');
  });

  it('loads the vendor group from D365 when the local vendor cache is empty', async () => {
    const pair = VendorInvoiceJournalService.pairKey('INV-2066', 'V-001');
    const d365VendorService = {
      getAllVendors: jest.fn().mockResolvedValue([
        {
          VendorAccountNumber: 'V-001',
          VendorGroupId: 'Trade',
        },
      ]),
    };
    const processor = new CashOutFreightEntryProcessor(
      { execute: jest.fn() } as any,
      {
        queryBus: {
          execute: jest.fn().mockResolvedValue({ items: [] }),
        },
        exchangeRateService: {},
        utilsService: new EntryProcessorUtilsService(),
        dimensionService: new DimensionValidationService(),
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService: {
          findExistingInvoiceVendorPairs: jest
            .fn()
            .mockResolvedValue(new Set([pair])),
          findInvoiceSettlementSnapshots: jest.fn().mockResolvedValue(
            new Map([
              [
                pair,
                {
                  company: 'm-p',
                  invoice: 'INV-2066',
                  vendorAccount: 'VEND-2066',
                  exists: true,
                  invoiceExistsAcrossVendors: true,
                  belongsToVendor: true,
                },
              ],
            ]),
          ),
        },
        cashOutExchangeRateService: {},
        generalJournalService: {},
        d365VendorService,
      } as any,
    );
    (processor as any).company = 'm-p';
    jest
      .spyOn(processor as any, 'collectSourceDimensionErrors')
      .mockImplementation(() => undefined);
    const lines = vendorPaymentLines();

    await expect(
      (processor as any).validateCashOutSourceAsync(lines),
    ).resolves.toBeUndefined();

    expect(lines[0].VendorGroup).toBe('Trade');
    expect(d365VendorService.getAllVendors).toHaveBeenCalledWith('m-p', {
      useCache: true,
      select: ['VendorAccountNumber', 'VendorGroupId'],
    });
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
        [{ Invoice: 'CUSTODY-VCH-1', Document: 'DOC-CUSTODY-1' }],
      ],
      [
        GeneralJournalService.custodySettlementTargetKey(targets[1]),
        [{ Invoice: 'CUSTODY-VCH-2', Document: 'DOC-CUSTODY-2' }],
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
    expect(formatted).toHaveLength(1);
    expect(formatted[0].MarkedInvoice).toBe('CUSTODY-VCH-1');
    expect(formatted[0].MarkedLines).toEqual([
      {
        InvoiceNumber: '',
        OperationNumber: 'OP-CUSTODY-1',
        DocumentNumber: 'DOC-CUSTODY-1',
        HasWithHoldingLine: false,
      },
      {
        InvoiceNumber: '',
        OperationNumber: 'OP-CUSTODY-2',
        DocumentNumber: 'DOC-CUSTODY-2',
        HasWithHoldingLine: false,
      },
    ]);
    expect(formatted[0].SettlementTargetType).toBe('CustodyLedger');
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

  it('falls back to live D365 dimensions and main accounts when the cache is empty', async () => {
    const queryBus = {
      execute: jest.fn().mockImplementation((query) => {
        if (query?.financialKey) return Promise.resolve([]);
        if (query?.filter?.chartNumber) {
          return Promise.resolve({ items: [] });
        }
        return Promise.resolve({ items: [] });
      }),
    };
    const d365DimensionService = {
      getDimensionValueList: jest.fn().mockResolvedValue({
        value: [{ DimensionValue: '012', RecId: 12 }],
      }),
    };
    const chartOfAccountsService = {
      getAllMainAccounts: jest.fn().mockResolvedValue([
        {
          ChartOfAccounts: 'Chart of Accounts',
          MainAccountId: '223201',
          MainAccountRecId: 223201,
          MainAccountType: 'BalanceSheet',
          Name: 'Cash clearing',
        },
      ]),
    };
    const processor = new CashOutFreightEntryProcessor(
      { execute: jest.fn() } as any,
      {
        queryBus,
        exchangeRateService: {},
        utilsService: new EntryProcessorUtilsService(),
        dimensionService: new DimensionValidationService(),
        taxGroupService: {},
        freeTextInvoiceService: {},
        vendorInvoiceJournalService: {},
        cashOutExchangeRateService: {},
        generalJournalService: {},
        d365DimensionService,
        chartOfAccountsService,
        d365VendorService: {},
      } as any,
    );
    (processor as any).company = 'm-p';

    const dimensions = await (processor as any).fetchDimensionValues({
      Activity: false,
    });
    const mainAccounts = await (processor as any).fetchMainAccounts(
      'Chart of Accounts',
    );

    expect(dimensions.get('Activity')).toEqual(new Set(['012']));
    expect(mainAccounts).toEqual(new Set(['223201']));
    expect(d365DimensionService.getDimensionValueList).toHaveBeenCalledWith(
      'Activity',
      'm-p',
      expect.objectContaining({ useCache: true }),
    );
    expect(chartOfAccountsService.getAllMainAccounts).toHaveBeenCalledWith(
      'Chart of Accounts',
      { useCache: true },
    );
  });
});
