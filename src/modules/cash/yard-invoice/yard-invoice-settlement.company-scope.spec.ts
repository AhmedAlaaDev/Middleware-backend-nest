import { YardInvoiceSettlementService } from './yard-invoice-settlement.service';

/**
 * Settled-row readback must be limited to the company. Journal batch numbers are
 * not unique across legal entities, so a read without the company would count
 * another company's settlements in the verification.
 */
describe('YardInvoiceSettlementService readback company scope', () => {
  it('filters settled invoices by the journal line company as well as the batch', async () => {
    const buildQuery = jest.fn((endpoint: string, options: unknown) => ({
      endpoint,
      options,
    }));
    const service = new YardInvoiceSettlementService(
      {} as never,
      { buildQuery } as never,
    );
    const readAll = jest.fn(async () => []);
    (service as unknown as { readAll: typeof readAll }).readAll = readAll;

    await (
      service as unknown as {
        readSettled: (c: string, j: string, a?: boolean) => Promise<unknown>;
      }
    ).readSettled('mas', 'Mesco-000001956', true);

    expect(buildQuery).toHaveBeenCalledWith(
      '/data/PaymentJournalLineSettledInvoices',
      expect.objectContaining({
        filter:
          "JournalLineCompany eq 'mas' and JournalBatchNumber eq 'Mesco-000001956'",
        crossCompany: true,
      }),
    );
  });
});
