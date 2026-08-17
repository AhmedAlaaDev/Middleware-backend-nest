import { VendorInvoiceJournalService } from './vendor-invoice-journal.service';

import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

describe('VendorInvoiceJournalService invoice lookup', () => {
  it('finds an invoice by invoice query when no vendor account is provided', async () => {
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
  });

  it('looks up posted invoices by vendor account first and matches case-insensitively in memory', async () => {
    const d365foClient = {
      get: jest.fn().mockResolvedValue({
        value: [
          {
            InvoiceId: 'EGDAMAX260025097',
            InvoiceAccount: 'RP-000007',
          },
          {
            InvoiceId: 'EGDAMAX260025100',
            InvoiceAccount: 'RP-000007',
          },
          {
            InvoiceId: 'EGDAMAX260025101',
            InvoiceAccount: 'RP-000007',
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

    const result = await service.findExistingInvoiceVendorPairs(
      'm-p',
      ['egdamax260025097', 'egdamax260025100', 'egdamax260025101'],
      {
        pairs: [
          { invoice: 'egdamax260025097', vendorAccount: 'RP-000007' },
          { invoice: 'egdamax260025100', vendorAccount: 'RP-000007' },
          { invoice: 'egdamax260025101', vendorAccount: 'RP-000007' },
        ],
      },
    );

    const query = decodeURIComponent(d365foClient.get.mock.calls[0][0]);
    // Verifies that OData filters by vendor account first
    expect(query).toContain("InvoiceAccount eq 'RP-000007'");
    // Verifies in-memory case-insensitive pair matching
    expect(
      result.has(
        VendorInvoiceJournalService.pairKey('egdamax260025097', 'RP-000007'),
      ),
    ).toBe(true);
    expect(
      result.has(
        VendorInvoiceJournalService.pairKey('egdamax260025100', 'RP-000007'),
      ),
    ).toBe(true);
    expect(
      result.has(
        VendorInvoiceJournalService.pairKey('egdamax260025101', 'RP-000007'),
      ),
    ).toBe(true);
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
