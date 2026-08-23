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
