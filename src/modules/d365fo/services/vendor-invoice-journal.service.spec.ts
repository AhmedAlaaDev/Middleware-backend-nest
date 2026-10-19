import { VendorInvoiceJournalService } from './vendor-invoice-journal.service';

describe('VendorInvoiceJournalService settlement candidate retrieval', () => {
  it('uses the narrow vendor and document lookup when document numbers are supplied', async () => {
    const service = new VendorInvoiceJournalService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const narrowLookup = jest
      .spyOn(service as any, 'fetchVendTransRowsByVendorAndDocument')
      .mockResolvedValue(new Map([['v-001', []]]));
    jest
      .spyOn(service as any, 'fetchVendTransRowsByVendorAndInvoice')
      .mockResolvedValue(new Map());
    const broadLookup = jest.spyOn(
      service as any,
      'fetchVendTransRowsByVendor',
    );

    await service.findInvoiceSettlementSnapshots('m-p', [
      {
        vendorAccount: 'V-001',
        documentNumber: 'DOC-100',
        invoice: 'INV-100',
      },
    ]);

    expect(narrowLookup).toHaveBeenCalledWith('m-p', [
      { vendorAccount: 'V-001', documentNumber: 'DOC-100' },
    ]);
    expect(broadLookup).not.toHaveBeenCalled();
  });

  it('loads candidates by vendor before document, invoice, and amount matching', async () => {
    const service = new VendorInvoiceJournalService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const vendorRows = [
      {
        AccountNum: 'V-001',
        DocumentNum: 'DOC-OTHER',
        Invoice: 'INV-OTHER',
        CurrencyCode: 'EGP',
        AmountCur: 75,
        RemainAmountCur: 75,
        Closed: 'No',
        Voucher: 'VCH-1',
      },
      {
        AccountNum: 'V-001',
        DocumentNum: 'DOC-100',
        Invoice: 'INV-100',
        CurrencyCode: 'EGP',
        AmountCur: 100,
        RemainAmountCur: 100,
        Closed: 'No',
        Voucher: 'VCH-2',
      },
    ];
    const fetchByVendor = jest
      .spyOn(service as any, 'fetchVendTransRowsByVendor')
      .mockResolvedValue(new Map([['v-001', vendorRows]]));
    const fetchByInvoice = jest.spyOn(
      service as any,
      'fetchVendTransRowsByInvoice',
    );

    const snapshots = await service.findInvoiceSettlementSnapshots('m-p', [
      { vendorAccount: 'V-001', invoice: 'INV-100' },
    ]);

    expect(fetchByVendor).toHaveBeenCalledWith('m-p', ['V-001']);
    expect(fetchByInvoice).not.toHaveBeenCalled();
    const snapshot = snapshots.get(
      VendorInvoiceJournalService.pairKey('INV-100', 'V-001'),
    );
    expect(snapshot?.exists).toBe(true);
    expect(snapshot?.belongsToVendor).toBe(true);
    expect(snapshot?.candidateTransactions).toHaveLength(2);
    expect(snapshot?.candidateTransactions?.[1]).toMatchObject({
      vendorAccount: 'V-001',
      documentNumber: 'DOC-100',
      invoiceNumber: 'INV-100',
      openAmount: 100,
    });
  });

  it('keeps equal vendor and invoice values separate by document number', async () => {
    const service = new VendorInvoiceJournalService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'fetchVendTransRowsByVendorAndDocument')
      .mockResolvedValue(
        new Map([
          [
            'v-001',
            [
              {
                AccountNum: 'V-001',
                DocumentNum: 'DOC-1',
                Invoice: 'INV-1',
                AmountCur: 100,
              },
              {
                AccountNum: 'V-001',
                DocumentNum: 'DOC-2',
                Invoice: 'INV-1',
                AmountCur: 200,
              },
            ],
          ],
        ]),
      );

    const snapshots = await service.findInvoiceSettlementSnapshots('m-p', [
      { vendorAccount: 'V-001', documentNumber: 'DOC-1', invoice: 'INV-1' },
      { vendorAccount: 'V-001', documentNumber: 'DOC-2', invoice: 'INV-1' },
    ]);

    expect(snapshots).toHaveProperty('size', 2);
    const doc1 = snapshots.get(
      VendorInvoiceJournalService.settlementKey('INV-1', 'V-001', 'DOC-1'),
    );
    const doc2 = snapshots.get(
      VendorInvoiceJournalService.settlementKey('INV-1', 'V-001', 'DOC-2'),
    );
    expect(doc1?.candidateTransactions).toHaveLength(1);
    expect(doc1?.candidateTransactions?.[0]).toMatchObject({
      documentNumber: 'DOC-1',
      originalAmount: 100,
    });
    expect(doc2?.candidateTransactions).toHaveLength(1);
    expect(doc2?.candidateTransactions?.[0]).toMatchObject({
      documentNumber: 'DOC-2',
      originalAmount: 200,
    });
    expect(
      snapshots.has(VendorInvoiceJournalService.pairKey('INV-1', 'V-001')),
    ).toBe(false);
  });

  it('maps the VendTrans closed date and settled amount fields correctly', async () => {
    const service = new VendorInvoiceJournalService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, 'fetchVendTransRowsByVendor').mockResolvedValue(
      new Map([
        [
          'tr-000031',
          [
            {
              AccountNum: 'Tr-000031',
              DocumentNum: '19341',
              Invoice: '178 - 2026',
              CurrencyCode: 'EGP',
              AmountCur: -15648.73,
              SettleAmountCur: 0,
              Closed: '1900-01-01T12:00:00Z',
            },
          ],
        ],
      ]),
    );

    const snapshots = await service.findInvoiceSettlementSnapshots('m-p', [
      { vendorAccount: 'Tr-000031', invoice: '178' },
    ]);
    const snapshot = snapshots.get(
      VendorInvoiceJournalService.pairKey('178', 'Tr-000031'),
    );

    expect(snapshot?.isOpen).toBe(true);
    expect(snapshot?.remainingAmount).toBeCloseTo(15648.73, 2);
    expect(snapshot?.candidateTransactions?.[0]).toMatchObject({
      invoiceNumber: '178 - 2026',
      originalAmount: 15648.73,
      openAmount: 15648.73,
      isOpen: true,
    });
  });

  it('calculates remaining amount after partial settlement', async () => {
    const service = new VendorInvoiceJournalService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, 'fetchVendTransRowsByVendor').mockResolvedValue(
      new Map([
        [
          'v-001',
          [
            {
              AccountNum: 'V-001',
              DocumentNum: 'DOC-1',
              Invoice: 'INV-1',
              CurrencyCode: 'EGP',
              AmountCur: -1000,
              SettleAmountCur: 250,
              Closed: '1900-01-01T12:00:00Z',
            },
          ],
        ],
      ]),
    );

    const snapshots = await service.findInvoiceSettlementSnapshots('m-p', [
      { vendorAccount: 'V-001', invoice: 'INV-1' },
    ]);
    const snapshot = snapshots.get(
      VendorInvoiceJournalService.pairKey('INV-1', 'V-001'),
    );

    expect(snapshot?.remainingAmount).toBe(750);
    expect(snapshot?.candidateTransactions?.[0].openAmount).toBe(750);
  });
});

it('matches a vendor transaction when Excel padded or marked the document number', async () => {
    const service = new VendorInvoiceJournalService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'fetchVendTransRowsByVendorAndDocument')
      .mockResolvedValue(
        new Map([
          [
            'rp-000001',
            [
              {
                AccountNum: 'RP-000001',
                DocumentNum: '1092',
                Invoice: '194323/1',
                CurrencyCode: 'EGP',
                AmountCur: -4560,
                Closed: '1900-01-01T12:00:00Z',
              },
            ],
          ],
        ]),
      );

    const snapshots = await service.findInvoiceSettlementSnapshots('m-p', [
      {
        vendorAccount: '\u200eRP-000001',
        documentNumber: '01092.0',
        invoice: '194323/1',
      },
    ]);
    const snapshot = snapshots.get(
      VendorInvoiceJournalService.settlementKey(
        '194323/1',
        '\u200eRP-000001',
        '01092.0',
      ),
    );

    expect(snapshot?.exists).toBe(true);
    expect(snapshot?.candidateTransactions?.[0]).toMatchObject({
      documentNumber: '1092',
      invoiceNumber: '194323/1',
    });
  });

  it('loads the vendor invoice when the document-scoped query misses it', async () => {
    const service = new VendorInvoiceJournalService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'fetchVendTransRowsByVendorAndDocument')
      .mockResolvedValue(new Map());
    const invoiceLookup = jest
      .spyOn(service as any, 'fetchVendTransRowsByVendorAndInvoice')
      .mockResolvedValue(
        new Map([
          [
            'rp-000001',
            [
              {
                AccountNum: 'RP-000001',
                DocumentNum: '1092',
                Invoice: '194323/1',
                SourceKey: '1',
                AmountCur: -4560,
                Closed: '1900-01-01T12:00:00Z',
              },
            ],
          ],
        ]),
      );

    const snapshots = await service.findInvoiceSettlementSnapshots('m-p', [
      {
        vendorAccount: 'RP-000001',
        documentNumber: '1092',
        invoice: '194323/1',
      },
    ]);

    expect(invoiceLookup).toHaveBeenCalledWith('m-p', [
      { vendorAccount: 'RP-000001', invoice: '194323/1' },
    ]);
    expect(
      snapshots.get(
        VendorInvoiceJournalService.settlementKey(
          '194323/1',
          'RP-000001',
          '1092',
        ),
      )?.exists,
    ).toBe(true);
  });

describe('VendorInvoiceJournalService vendor payment settlement posting', () => {
  it('creates and verifies the OData settlement body after resolving invoice due date', async () => {
    const d365foClient = {
      get: jest.fn((endpoint: string) => {
        if (endpoint === '/data/VendTransBiEntities') {
          return Promise.resolve({
            value: [
              {
                Invoice: 'INV-1',
                AccountNum: 'Sl-000020',
                CurrencyCode: 'EGP',
                Closed: '1900-01-01T12:00:00Z',
                AmountCur: -500,
                RemainAmountCur: -500,
                DocumentNum: 'DOC-1',
                DueDate: '2026-09-30T12:00:00Z',
              },
            ],
          });
        }
        if (endpoint === '/data/VendorPaymentJournalLineSettledInvoices') {
          const settlementReads = d365foClient.get.mock.calls.filter(
            ([calledEndpoint]: [string]) =>
              calledEndpoint ===
              '/data/VendorPaymentJournalLineSettledInvoices',
          ).length;
          return Promise.resolve({
            value:
              settlementReads === 1
                ? []
                : [
                    {
                      JournalLineCompany: 'm-p',
                      JournalBatchNumber: 'Mesco-000015200',
                      JournalLineNumber: 1,
                      InvoiceNumber: 'INV-1',
                      InvoiceCompany: 'm-p',
                      SettlementAmountInInvoiceCurrency: -300,
                      invoiceAccount: 'Sl-000020',
                    },
                  ],
          });
        }
        return Promise.resolve({ value: [] });
      }),
      post: jest.fn().mockResolvedValue({}),
    };
    const queryBuilder = {
      and: jest.fn(() => 'filter'),
      or: jest.fn(() => 'line-filter'),
      eq: jest.fn(() => 'condition'),
      buildQuery: jest.fn((endpoint: string) => endpoint),
    };
    const service = new VendorInvoiceJournalService(
      d365foClient,
      queryBuilder as any,
      {} as any,
      {} as any,
    );

    const result = await service.createVendorPaymentJournalLineSettlements({
      company: 'm-p',
      journalBatchNumber: 'Mesco-000015200',
      targets: [
        {
          lineNumber: 1,
          vendorAccount: 'Sl-000020',
          currencyCode: 'EGP',
          debitAmount: 300,
          creditAmount: 0,
          invoiceNumber: 'INV-1',
          documentNumber: 'DOC-1',
        },
      ],
    });

    expect(d365foClient.post).toHaveBeenCalledWith(
      '/data/VendorPaymentJournalLineSettledInvoices',
      {
        JournalLineCompany: 'm-p',
        JournalBatchNumber: 'Mesco-000015200',
        JournalLineNumber: 1,
        InvoiceNumber: 'INV-1',
        InvoiceCompany: 'm-p',
        InvoiceDueDate: '2026-09-30T12:00:00Z',
        SettlementAmountInInvoiceCurrency: -300,
        CashDiscountToTakeInInvoiceCurrency: 0,
      },
      { retries: 0 },
    );
    const vendTransQueryOptions = queryBuilder.buildQuery.mock.calls.find(
      ([endpoint]: [string]) => endpoint === '/data/VendTransBiEntities',
    )?.[1];
    expect(vendTransQueryOptions?.select).toContain('SettleAmountCur');
    expect(vendTransQueryOptions?.select).not.toContain('RemainAmountCur');
    expect(result).toEqual([
      expect.objectContaining({
        lineNumber: 1,
        status: 'VERIFIED',
        matchedInvoices: ['INV-1'],
      }),
    ]);
  });

  it('combines main and withholding lines into one gross invoice settlement', async () => {
    const d365foClient = {
      post: jest.fn().mockResolvedValue({}),
      patch: jest.fn(),
    };
    const service = new VendorInvoiceJournalService(
      d365foClient as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'fetchSettledInvoicesByJournalLine')
      .mockResolvedValue(new Map());
    jest
      .spyOn(service as any, 'findOpenInvoiceForJournalSettlement')
      .mockResolvedValue({
        AmountCur: -1000,
        SettleAmountCur: 0,
        DueDate: '2026-09-30T12:00:00Z',
      });
    jest
      .spyOn(service, 'verifyVendorPaymentJournalSettlements')
      .mockResolvedValue([
        {
          lineNumber: 1,
          status: 'VERIFIED',
          reason: 'verified',
          expectedVendorAccount: 'V-001',
          expectedInvoices: ['INV-1'],
          matchedInvoices: ['INV-1'],
          settlementAmount: -1000,
          journalBatchNumber: 'JN-1',
          journalMarkedInvoice: '',
          settleVoucher: '',
          journalLineExists: true,
        },
      ]);

    await service.createVendorPaymentJournalLineSettlements({
      company: 'm-p',
      journalBatchNumber: 'JN-1',
      targets: [
        {
          lineNumber: 1,
          vendorAccount: 'V-001',
          currencyCode: 'EGP',
          debitAmount: 900,
          creditAmount: 0,
          invoiceNumber: 'INV-1',
          documentNumber: 'DOC-1',
        },
        {
          lineNumber: 2,
          vendorAccount: 'V-001',
          currencyCode: 'EGP',
          debitAmount: 100,
          creditAmount: 0,
          invoiceNumber: 'INV-1',
          documentNumber: 'DOC-1',
        },
      ],
    });

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(d365foClient.post).toHaveBeenCalledWith(
      '/data/VendorPaymentJournalLineSettledInvoices',
      expect.objectContaining({
        JournalLineNumber: 1,
        InvoiceNumber: 'INV-1',
        SettlementAmountInInvoiceCurrency: -1000,
      }),
      { retries: 0 },
    );
  });

  it('includes the Excel UniqueId when a settlement exceeds the invoice remainder', async () => {
    const service = new VendorInvoiceJournalService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'fetchSettledInvoicesByJournalLine')
      .mockResolvedValue(new Map());
    jest
      .spyOn(service as any, 'findOpenInvoiceForJournalSettlement')
      .mockResolvedValue({
        AmountCur: -298.84,
        SettleAmountCur: 0,
        DueDate: '2026-01-28T12:00:00Z',
      });

    await expect(
      service.createVendorPaymentJournalLineSettlements({
        company: 'm-p',
        journalBatchNumber: 'JN-1',
        targets: [
          {
            lineNumber: 4,
            vendorAccount: 'Sl-000036',
            currencyCode: 'USD',
            debitAmount: 298.86,
            creditAmount: 0,
            invoiceNumber: '5815372458',
            documentNumber: '16760',
            uniqueId: '475761',
          },
        ],
      }),
    ).rejects.toThrow(
      'Settlement amount 298.86 for cash-out line 4 (Excel UniqueId 475761) exceeds invoice 5815372458 remainder 298.84.',
    );
  });

  it('skips a remainder failure and continues settling later invoices when continueOnError is set', async () => {
    const d365foClient = {
      post: jest.fn().mockResolvedValue({}),
      patch: jest.fn(),
    };
    const service = new VendorInvoiceJournalService(
      d365foClient as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'fetchSettledInvoicesByJournalLine')
      .mockResolvedValue(new Map());
    jest
      .spyOn(service as any, 'findOpenInvoiceForJournalSettlement')
      .mockImplementation(async (_company: string, target: { invoiceNumber: string }) =>
        target.invoiceNumber === '5815372458'
          ? {
              AmountCur: -298.84,
              SettleAmountCur: 0,
              DueDate: '2026-01-28T12:00:00Z',
            }
          : {
              AmountCur: -100,
              SettleAmountCur: 0,
              DueDate: '2026-01-28T12:00:00Z',
            },
      );
    jest
      .spyOn(service, 'verifyVendorPaymentJournalSettlements')
      .mockResolvedValue([
        {
          lineNumber: 6,
          status: 'VERIFIED',
          reason: 'verified',
          expectedVendorAccount: 'Sl-000036',
          expectedInvoices: ['INV-OK'],
          matchedInvoices: ['INV-OK'],
          settlementAmount: -100,
          journalBatchNumber: 'JN-1',
          journalMarkedInvoice: '',
          settleVoucher: '',
          journalLineExists: true,
        },
      ]);

    const skipped: Array<{ uniqueId: string; phase: string; error: string }> =
      [];
    await service.createVendorPaymentJournalLineSettlements({
      company: 'm-p',
      journalBatchNumber: 'JN-1',
      continueOnError: true,
      skipped: skipped as any,
      targets: [
        {
          lineNumber: 4,
          vendorAccount: 'Sl-000036',
          currencyCode: 'USD',
          debitAmount: 298.86,
          creditAmount: 0,
          invoiceNumber: '5815372458',
          documentNumber: '16760',
          uniqueId: '475761',
          sourceLineNumber: 841,
        },
        {
          lineNumber: 6,
          vendorAccount: 'Sl-000036',
          currencyCode: 'USD',
          debitAmount: 100,
          creditAmount: 0,
          invoiceNumber: 'INV-OK',
          documentNumber: 'DOC-OK',
          uniqueId: '999001',
          sourceLineNumber: 900,
        },
      ],
    });

    expect(skipped).toEqual([
      expect.objectContaining({
        uniqueId: '475761',
        excelLineNumbers: [841],
        phase: 'settle',
        invoiceNumber: '5815372458',
      }),
    ]);
    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(d365foClient.post).toHaveBeenCalledWith(
      '/data/VendorPaymentJournalLineSettledInvoices',
      expect.objectContaining({
        JournalLineNumber: 6,
        InvoiceNumber: 'INV-OK',
      }),
      { retries: 0 },
    );
  });

  it('expands a partial settlement created by an earlier failed attempt', async () => {
    const d365foClient = {
      post: jest.fn(),
      patch: jest.fn().mockResolvedValue(undefined),
    };
    const service = new VendorInvoiceJournalService(
      d365foClient as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'fetchSettledInvoicesByJournalLine')
      .mockResolvedValue(
        new Map([
          [
            1,
            [
              {
                JournalLineNumber: 1,
                InvoiceNumber: 'INV-1',
                InvoiceCompany: 'm-p',
                InvoiceDueDate: '2026-09-30T12:00:00Z',
                SettlementAmountInInvoiceCurrency: -900,
                invoiceAccount: 'V-001',
              },
            ],
          ],
        ]),
      );
    jest
      .spyOn(service, 'verifyVendorPaymentJournalSettlements')
      .mockResolvedValue([
        {
          lineNumber: 1,
          status: 'VERIFIED',
          reason: 'verified',
          expectedVendorAccount: 'V-001',
          expectedInvoices: ['INV-1'],
          matchedInvoices: ['INV-1'],
          settlementAmount: -1000,
          journalBatchNumber: 'JN-1',
          journalMarkedInvoice: '',
          settleVoucher: '',
          journalLineExists: true,
        },
      ]);

    await service.createVendorPaymentJournalLineSettlements({
      company: 'm-p',
      journalBatchNumber: 'JN-1',
      targets: [
        {
          lineNumber: 1,
          vendorAccount: 'V-001',
          currencyCode: 'EGP',
          debitAmount: 900,
          creditAmount: 0,
          invoiceNumber: 'INV-1',
          documentNumber: 'DOC-1',
        },
        {
          lineNumber: 2,
          vendorAccount: 'V-001',
          currencyCode: 'EGP',
          debitAmount: 100,
          creditAmount: 0,
          invoiceNumber: 'INV-1',
          documentNumber: 'DOC-1',
        },
      ],
    });

    expect(d365foClient.post).not.toHaveBeenCalled();
    expect(d365foClient.patch).toHaveBeenCalledWith(
      expect.stringContaining(
        "JournalBatchNumber='JN-1',JournalLineNumber=1,InvoiceNumber='INV-1'",
      ),
      { SettlementAmountInInvoiceCurrency: -1000 },
      { headers: { 'If-Match': '*' } },
    );
  });
});
