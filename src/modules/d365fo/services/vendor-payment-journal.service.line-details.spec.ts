import { VendorPaymentJournalService } from './vendor-payment-journal.service';

/**
 * Read-back of the COMPLETE D365 journal: every page is followed, and a
 * repeated page, a repeated line or a line without a number refuses the result
 * instead of returning something that looks complete.
 */
describe('VendorPaymentJournalService.listJournalLineDetails', () => {
  const row = (lineNumber: number, extra: Record<string, unknown> = {}) => ({
    LineNumber: lineNumber,
    PaymentId: `P${lineNumber}`,
    AccountType: 'Ledger',
    AccountDisplayValue: `2234${lineNumber}|1201`,
    CurrencyCode: 'EGP',
    DebitAmount: lineNumber,
    CreditAmount: 0,
    Voucher: `V${lineNumber}`,
    ...extra,
  });

  const build = (pages: Array<Record<string, unknown>>) => {
    const get = jest.fn();
    pages.forEach((page) => get.mockResolvedValueOnce(page));
    const buildQuery = jest
      .fn()
      .mockReturnValue('/data/VendorPaymentJournalLines?first');
    const service = new VendorPaymentJournalService(
      { get } as any,
      { and: jest.fn(), eq: jest.fn(), buildQuery } as any,
      {} as any,
      {} as any,
    );
    return { service, get, buildQuery };
  };

  it('selects only fields verified on the D365 entity', async () => {
    const { service, buildQuery } = build([{ value: [] }]);

    await service.listJournalLineDetails('Mesco-000019470', 'm-p');

    expect(buildQuery).toHaveBeenCalledWith(
      '/data/VendorPaymentJournalLines',
      expect.objectContaining({
        crossCompany: true,
        select: [
          'LineNumber',
          'PaymentId',
          'AccountType',
          'AccountDisplayValue',
          'CurrencyCode',
          'DebitAmount',
          'CreditAmount',
          'Voucher',
        ],
      }),
    );
  });

  it('returns every line of a single page, converted to cents', async () => {
    const { service } = build([{ value: [row(1, { DebitAmount: 12.5 })] }]);

    const lines = await service.listJournalLineDetails('J', 'm-p');

    expect(lines).toEqual([
      expect.objectContaining({
        lineNumber: 1,
        paymentId: 'P1',
        accountType: 'Ledger',
        debitCents: 1250,
        creditCents: 0,
        voucher: 'V1',
      }),
    ]);
  });

  it('follows @odata.nextLink through every page', async () => {
    const { service, get } = build([
      {
        value: [row(1), row(2)],
        '@odata.nextLink':
          'https://host.example/data/VendorPaymentJournalLines?$skiptoken=a',
      },
      {
        value: [row(3)],
        '@odata.nextLink':
          'https://host.example/data/VendorPaymentJournalLines?$skiptoken=b',
      },
      { value: [row(4), row(5)] },
    ]);

    const lines = await service.listJournalLineDetails('J', 'm-p');

    expect(lines.map((l) => l.lineNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls[1][0]).toBe(
      '/data/VendorPaymentJournalLines?$skiptoken=a',
    );
    expect(get.mock.calls[2][0]).toBe(
      '/data/VendorPaymentJournalLines?$skiptoken=b',
    );
  });

  it('refuses a continuation loop', async () => {
    const loop = {
      value: [row(1)],
      '@odata.nextLink':
        'https://host.example/data/VendorPaymentJournalLines?first',
    };
    // The first page's next link points back to the first page.
    const { service } = build([loop, { ...loop, value: [row(2)] }]);

    await expect(service.listJournalLineDetails('J', 'm-p')).rejects.toThrow(
      'repeated the page',
    );
  });

  it('refuses a line returned twice', async () => {
    const { service } = build([
      {
        value: [row(1)],
        '@odata.nextLink':
          'https://host.example/data/VendorPaymentJournalLines?$skiptoken=a',
      },
      { value: [row(1)] },
    ]);

    await expect(service.listJournalLineDetails('J', 'm-p')).rejects.toThrow(
      'twice or without a line number',
    );
  });

  it('refuses a line without a line number', async () => {
    const { service } = build([{ value: [row(0)] }]);

    await expect(service.listJournalLineDetails('J', 'm-p')).rejects.toThrow(
      'twice or without a line number',
    );
  });

  it('propagates a D365 failure so the caller cannot treat it as an empty journal', async () => {
    const get = jest.fn().mockRejectedValue(new Error('503'));
    const service = new VendorPaymentJournalService(
      { get } as any,
      {
        and: jest.fn(),
        eq: jest.fn(),
        buildQuery: jest.fn().mockReturnValue('/x'),
      } as any,
      {} as any,
      {} as any,
    );

    await expect(service.listJournalLineDetails('J', 'm-p')).rejects.toThrow(
      '503',
    );
  });
});
