import { ODataQueryBuilderService } from './odata-query-builder.service';
import { VendorInvoiceJournalService } from './vendor-invoice-journal.service';

describe('vendor settlement against uploaded D365 line identity', () => {
  const target = {
    lineNumber: 577,
    uniqueId: '561746',
    vendorAccount: 'Sl-000001',
    currencyCode: 'EGP',
    debitAmount: 912,
    creditAmount: 0,
    invoiceNumber: 'l202685915',
    documentNumber: '25675',
  };
  const actual = {
    LineNumber: 572,
    PaymentId: '561746',
    AccountDisplayValue: 'Sl-000001',
    CurrencyCode: 'EGP',
    DebitAmount: 912,
    CreditAmount: 0,
  };
  function harness(rows: object[]) {
    const client = {
      get: jest.fn(async (url: string) => ({
        value: url.startsWith('/data/VendorPaymentJournalLines?') ? rows : [],
      })),
      post: jest.fn().mockResolvedValue({}),
    };
    const service = new VendorInvoiceJournalService(
      client as any,
      new ODataQueryBuilderService(),
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'findOpenInvoiceForJournalSettlement')
      .mockResolvedValue({
        AmountCur: -10000,
        SettleAmountCur: 0,
        DueDate: '2026-09-30T12:00:00Z',
      });
    jest
      .spyOn(service, 'verifyVendorPaymentJournalSettlements')
      .mockImplementation(
        async ({ lines }) =>
          lines.map((line: any) => ({
            ...line,
            status: 'VERIFIED',
            settlementAmount: line.expectedSettlementAmount,
          })) as any,
      );
    const run = (
      targets = [target],
      continueOnError = false,
      skipped: any[] = [],
    ) =>
      service.createVendorPaymentJournalLineSettlements({
        company: 'm-p',
        journalBatchNumber: 'Mesco-000019377',
        targets,
        continueOnError,
        skipped,
      });
    return { service, client, run };
  }
  it('settles on line 572 when planned line 577 belongs to another vendor', async () => {
    const { client, run, service } = harness([
      actual,
      {
        ...actual,
        LineNumber: 577,
        PaymentId: 'OTHER',
        AccountDisplayValue: 'RP-000007',
        DebitAmount: 200,
      },
    ]);
    await run();
    expect(client.post).toHaveBeenCalledWith(
      '/data/VendorPaymentJournalLineSettledInvoices',
      expect.objectContaining({
        JournalLineNumber: 572,
        InvoiceNumber: target.invoiceNumber,
        SettlementAmountInInvoiceCurrency: -912,
      }),
      { retries: 0 },
    );
    expect(service.verifyVendorPaymentJournalSettlements).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [expect.objectContaining({ lineNumber: 572 })],
      }),
    );
  });
  it('rejects an unrelated line even when its line number is exactly the planned number', async () => {
    const { client, run } = harness([
      { ...actual, LineNumber: 577, PaymentId: 'OTHER' },
    ]);
    await expect(run()).rejects.toThrow('found 0 matches');
    expect(client.post).not.toHaveBeenCalled();
  });
  it('rejects ambiguous identical payment lines rather than choosing by planned number', async () => {
    const { client, run } = harness([actual, { ...actual, LineNumber: 577 }]);
    await expect(run()).rejects.toThrow('found 2 matches');
    expect(client.post).not.toHaveBeenCalled();
  });
  it('resolves net and withholding components before combining their gross settlement', async () => {
    const { client, run } = harness([
      { ...actual, DebitAmount: 900 },
      { ...actual, LineNumber: 573, DebitAmount: 12 },
    ]);
    await run([
      { ...target, debitAmount: 900 },
      { ...target, lineNumber: 578, debitAmount: 12 },
    ]);
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(client.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        JournalLineNumber: 572,
        SettlementAmountInInvoiceCurrency: -912,
      }),
      { retries: 0 },
    );
  });
  it('skips the entire invoice when one component cannot be mapped', async () => {
    const { client, run } = harness([{ ...actual, DebitAmount: 900 }]);
    const skipped: any[] = [];
    await run(
      [
        { ...target, debitAmount: 900 },
        { ...target, lineNumber: 578, debitAmount: 12 },
      ],
      true,
      skipped,
    );
    expect(client.post).not.toHaveBeenCalled();
    expect(skipped).toHaveLength(1);
    expect(skipped[0].error).toContain('found 0 matches');
  });
  it('keeps journal reads bounded and follows pagination when verifying many lines', async () => {
    const { service, client } = harness([]);
    client.get
      .mockResolvedValueOnce({
        value: [actual],
        '@odata.nextLink': 'https://example.com/data/next?page=2',
      } as any)
      .mockResolvedValueOnce({ value: [{ ...actual, LineNumber: 999 }] });
    const rows = await (service as any).fetchVendorPaymentJournalLinesByNumber(
      'm-p',
      'JN-1',
      Array.from({ length: 1000 }, (_, i) => i + 1),
    );
    expect(client.get.mock.calls[0][0].length).toBeLessThan(1000);
    expect(client.get.mock.calls[1][0]).toBe('/data/next?page=2');
    expect([...rows.keys()]).toEqual([572, 999]);
  });
});
