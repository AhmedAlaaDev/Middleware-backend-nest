import { VendorInvoiceJournalService } from './vendor-invoice-journal.service';

import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

describe('VendorInvoiceJournalService invoice lookup', () => {
  it('finds an invoice that is already posted in Finance', async () => {
    const d365foClient = {
      get: jest.fn().mockResolvedValue({
        value: [
          {
            InvoiceId: ' INV/2026/00597 ',
            InvoiceAccount: '\u200fSu-000166',
          },
        ],
      }),
    };
    const retryService = {
      executeWithRetry: jest.fn((operation: () => Promise<unknown>) =>
        operation(),
      ),
      isFoThrottleError: jest.fn().mockReturnValue(false),
    };
    const errorExtractor = {
      extractMessage: jest.fn().mockReturnValue('lookup failed'),
    };
    const service = new VendorInvoiceJournalService(
      d365foClient as any,
      new ODataQueryBuilderService(),
      retryService as any,
      errorExtractor as any,
    );

    const result = await service.findExistingInvoiceVendorPairs('m-p', [
      '\u200bINV/2026/00597',
    ]);

    expect(result).toEqual(
      new Set([
        VendorInvoiceJournalService.pairKey('INV/2026/00597', 'Su-000166'),
      ]),
    );
    expect(d365foClient.get).toHaveBeenCalledTimes(1);
    expect(d365foClient.get.mock.calls[0][0]).toContain(
      '/data/VendInvoiceJourBiEntities',
    );
    expect(d365foClient.get.mock.calls[0][0]).toContain('InvoiceId');
    expect(decodeURIComponent(d365foClient.get.mock.calls[0][0])).toContain(
      "InvoiceId eq ' INV/2026/00597'",
    );
    expect(decodeURIComponent(d365foClient.get.mock.calls[0][0])).toContain(
      "InvoiceId eq ' INV/2026/00597 '",
    );
  });

  it('looks up posted invoices from the vendor account, not invoice-only', async () => {
    const d365foClient = {
      get: jest.fn().mockResolvedValue({
        value: [
          {
            InvoiceId: '386',
            InvoiceAccount: 'RP-000003',
          },
        ],
      }),
    };
    const service = new VendorInvoiceJournalService(
      d365foClient as any,
      new ODataQueryBuilderService(),
      {
        executeWithRetry: jest.fn((operation: () => Promise<unknown>) =>
          operation(),
        ),
        isFoThrottleError: jest.fn().mockReturnValue(false),
      } as any,
      { extractMessage: jest.fn() } as any,
    );

    await service.findExistingInvoiceVendorPairs('m-p', ['386'], {
      pairs: [{ invoice: '386', vendorAccount: 'RP-000003' }],
    });

    const query = decodeURIComponent(d365foClient.get.mock.calls[0][0]);
    expect(query).toContain("InvoiceAccount eq 'RP-000003'");
    expect(query).toContain("InvoiceId eq '386'");
  });

  it('returns the exact D365 InvoiceId for a normalized invoice/vendor pair', async () => {
    const d365foClient = {
      get: jest.fn().mockResolvedValue({
        value: [
          {
            InvoiceId: ' GDY_FV000005995',
            InvoiceAccount: 'Ag-000194',
          },
        ],
      }),
    };
    const service = new VendorInvoiceJournalService(
      d365foClient as any,
      new ODataQueryBuilderService(),
      {
        executeWithRetry: jest.fn((operation: () => Promise<unknown>) =>
          operation(),
        ),
        isFoThrottleError: jest.fn().mockReturnValue(false),
      } as any,
      { extractMessage: jest.fn() } as any,
    );

    const result = await service.findExistingInvoiceVendorPairInvoiceIds(
      'm-p',
      ['GDY_FV000005995 '],
    );

    expect(
      result.get(
        VendorInvoiceJournalService.pairKey('GDY_FV000005995 ', 'Ag-000194'),
      ),
    ).toBe(' GDY_FV000005995');
  });
});
