import { ODataQueryBuilderService } from './odata-query-builder.service';
import { VendorInvoiceJournalService } from './vendor-invoice-journal.service';

/**
 * Regression coverage for the production incident where settlement requests
 * used planned line numbers instead of the real D365 line numbers, plus the
 * decimal, ambiguity, idempotency and D365-failure handling around it.
 * D365 is fully mocked: nothing here can write to a real journal.
 */
const OPEN = '1900-01-01T12:00:00Z';
const DUE = '2026-09-30T12:00:00Z';

type Line = {
  LineNumber: number;
  PaymentId: string;
  AccountDisplayValue: string;
  CurrencyCode: string;
  DebitAmount: number;
  CreditAmount: number;
};

const supplier = (
  LineNumber: number,
  PaymentId: string,
  AccountDisplayValue: string,
  DebitAmount: number,
  CurrencyCode = 'EGP',
): Line => ({
  LineNumber,
  PaymentId,
  AccountDisplayValue,
  CurrencyCode,
  DebitAmount,
  CreditAmount: 0,
});
const custody = (
  LineNumber: number,
  PaymentId: string,
  CreditAmount: number,
  CurrencyCode = 'EGP',
): Line => ({
  LineNumber,
  PaymentId,
  AccountDisplayValue: '3210',
  CurrencyCode,
  DebitAmount: 0,
  CreditAmount,
});
const trans = (
  Invoice: string,
  AccountNum: string,
  amount: number,
  extra: Record<string, unknown> = {},
) => ({
  Invoice,
  AccountNum,
  CurrencyCode: 'EGP',
  Closed: OPEN,
  AmountCur: -amount,
  SettleAmountCur: 0,
  DocumentNum: '25675',
  DueDate: DUE,
  ...extra,
});
const target = (
  lineNumber: number,
  uniqueId: string | undefined,
  vendorAccount: string,
  invoiceNumber: string,
  debitAmount: number,
  currencyCode = 'EGP',
) => ({
  lineNumber,
  ...(uniqueId ? { uniqueId } : {}),
  vendorAccount,
  currencyCode,
  debitAmount,
  creditAmount: 0,
  invoiceNumber,
  documentNumber: '25675',
});

function harness(options: {
  lines: Line[];
  vendTrans: object[];
  settled?: object[];
  postError?: Error;
  persistPost?: boolean;
}) {
  const settled: object[] = [...(options.settled ?? [])];
  const client = {
    get: jest.fn((url: string) => {
      const decoded = decodeURIComponent(url);
      if (url.startsWith('/data/VendorPaymentJournalLines?')) {
        return Promise.resolve({ value: options.lines });
      }
      if (url.startsWith('/data/VendorPaymentJournalLineSettledInvoices')) {
        return Promise.resolve({ value: settled });
      }
      if (url.startsWith('/data/VendTransBiEntities')) {
        return Promise.resolve({
          value: options.vendTrans.filter((row: any) =>
            decoded.includes(`Invoice eq '${row.Invoice}'`),
          ),
        });
      }
      return Promise.resolve({ value: [] });
    }),
    post: jest.fn((_url: string, body: any) => {
      if (options.postError) return Promise.reject(options.postError);
      if (options.persistPost !== false) {
        settled.push({
          ...body,
          invoiceAccount: options.lines.find(
            (line) => line.LineNumber === body.JournalLineNumber,
          )?.AccountDisplayValue,
        });
      }
      return Promise.resolve({});
    }),
    patch: jest.fn().mockResolvedValue({}),
  };
  const service = new VendorInvoiceJournalService(
    client as any,
    new ODataQueryBuilderService(),
    {} as any,
    {} as any,
  );
  const run = (
    targets: any[],
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
  const posted = () =>
    client.post.mock.calls.map(([, body]: any) => [
      body.JournalLineNumber,
      body.InvoiceNumber,
      body.SettlementAmountInInvoiceCurrency,
    ]);
  return { client, service, run, posted, settled };
}

describe('settlement line identity after D365 line-number gaps', () => {
  it('settles planned lines 561 and 577 on the real lines 556 and 572 (multiple skipped UniqueIds)', async () => {
    const { run, posted } = harness({
      lines: [
        custody(555, 'P1', 70, 'USD'),
        supplier(556, 'P1', 'Sl-000014', 70, 'USD'),
        custody(571, 'P2', 912),
        supplier(572, 'P2', 'Sl-000001', 912),
        custody(561, 'P3', 912),
        supplier(562, 'P3', 'Sl-000001', 912),
      ],
      vendTrans: [
        trans('CFO/MED/2026/11361', 'Sl-000014', 70, { CurrencyCode: 'USD' }),
        trans('l202685915', 'Sl-000001', 912),
      ],
    });
    await run([
      target(561, 'P1', 'Sl-000014', 'CFO/MED/2026/11361', 70, 'USD'),
      target(577, 'P2', 'Sl-000001', 'l202685915', 912),
    ]);
    expect(posted()).toEqual([
      [556, 'CFO/MED/2026/11361', -70],
      [572, 'l202685915', -912],
    ]);
  });

  it('rejects a custody/ledger line that merely carries the planned number', async () => {
    const { run, client } = harness({
      lines: [custody(561, 'P1', 70, 'USD')],
      vendTrans: [
        trans('CFO/MED/2026/11361', 'Sl-000014', 70, { CurrencyCode: 'USD' }),
      ],
    });
    await expect(
      run([target(561, 'P1', 'Sl-000014', 'CFO/MED/2026/11361', 70, 'USD')]),
    ).rejects.toThrow('[JOURNAL_LINE_NOT_FOUND]');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('rejects a same-payment line that belongs to another vendor', async () => {
    const { run, client } = harness({
      lines: [supplier(572, 'P2', 'RP-000007', 912)],
      vendTrans: [trans('l202685915', 'Sl-000001', 912)],
    });
    await expect(
      run([target(572, 'P2', 'Sl-000001', 'l202685915', 912)]),
    ).rejects.toThrow('found 0 matches');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('never falls back to the planned line number when the payment ID is missing', async () => {
    const { run, client } = harness({
      lines: [supplier(556, 'P1', 'Sl-000014', 70, 'USD')],
      vendTrans: [
        trans('CFO/MED/2026/11361', 'Sl-000014', 70, { CurrencyCode: 'USD' }),
      ],
    });
    await expect(
      run([
        target(556, undefined, 'Sl-000014', 'CFO/MED/2026/11361', 70, 'USD'),
      ]),
    ).rejects.toThrow('[JOURNAL_LINE_NOT_FOUND]');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('reports exact duplicate supplier lines as ambiguous instead of guessing', async () => {
    const { run, client } = harness({
      lines: [
        supplier(154, 'P9', 'RP-000007', 500),
        supplier(156, 'P9', 'RP-000007', 500),
      ],
      vendTrans: [trans('egdamax260051305', 'RP-000007', 500)],
    });
    const skipped: any[] = [];
    await run(
      [target(154, 'P9', 'RP-000007', 'egdamax260051305', 500)],
      true,
      skipped,
    );
    expect(client.post).not.toHaveBeenCalled();
    expect(skipped).toHaveLength(1);
    expect(skipped[0].error).toContain('[JOURNAL_LINE_AMBIGUOUS]');
  });

  it('keeps equal-amount payments of one vendor on their own lines and invoices', async () => {
    const { run, posted } = harness({
      lines: [
        supplier(10, 'A', 'Sl-000001', 912),
        supplier(12, 'B', 'Sl-000001', 912),
      ],
      vendTrans: [
        trans('INV-A', 'Sl-000001', 912),
        trans('INV-B', 'Sl-000001', 912),
      ],
    });
    await run([
      target(99, 'B', 'Sl-000001', 'INV-B', 912),
      target(98, 'A', 'Sl-000001', 'INV-A', 912),
    ]);
    expect(posted().sort()).toEqual([
      [10, 'INV-A', -912],
      [12, 'INV-B', -912],
    ]);
  });
});

describe('settlement amounts are compared as currency cents', () => {
  it('matches a 4-decimal source amount to the 2-decimal D365 line and settles whole cents', async () => {
    const { run, posted } = harness({
      lines: [supplier(552, 'P5', 'Sl-000001', 120)],
      vendTrans: [trans('l202691498', 'Sl-000001', 120)],
    });
    await run([target(560, 'P5', 'Sl-000001', 'l202691498', 119.9964)]);
    expect(posted()).toEqual([[552, 'l202691498', -120]]);
  });

  it('caps a one-cent source difference at the open balance but rejects a real over-settlement', async () => {
    const capped = harness({
      lines: [supplier(10, 'A', 'Sl-000001', 912)],
      vendTrans: [trans('INV-A', 'Sl-000001', 911.99)],
    });
    await capped.run([target(10, 'A', 'Sl-000001', 'INV-A', 912)]);
    expect(capped.posted()).toEqual([[10, 'INV-A', -911.99]]);

    const over = harness({
      lines: [supplier(10, 'A', 'Sl-000001', 912)],
      vendTrans: [trans('INV-A', 'Sl-000001', 911.97)],
    });
    await expect(
      over.run([target(10, 'A', 'Sl-000001', 'INV-A', 912)]),
    ).rejects.toThrow('[SETTLEMENT_AMOUNT_INVALID]');
    expect(over.client.post).not.toHaveBeenCalled();
  });

  it('takes the remaining balance after a partial settlement into account', async () => {
    const { run, posted } = harness({
      lines: [supplier(10, 'A', 'Sl-000001', 300)],
      vendTrans: [
        trans('INV-A', 'Sl-000001', 1000, { SettleAmountCur: -700 }),
      ],
    });
    await run([target(10, 'A', 'Sl-000001', 'INV-A', 300)]);
    expect(posted()).toEqual([[10, 'INV-A', -300]]);
  });
});

describe('open invoice ambiguity', () => {
  const makeService = (rows: object[]) => {
    const client = { get: jest.fn(() => Promise.resolve({ value: rows })) };
    return new VendorInvoiceJournalService(
      client as any,
      new ODataQueryBuilderService(),
      {} as any,
      {} as any,
    );
  };
  const base = {
    lineNumber: 1,
    vendorAccount: 'RP-000007',
    currencyCode: 'EGP',
    debitAmount: 500,
    creditAmount: 0,
    invoiceNumber: 'egdamax260051305',
    documentNumber: '25675',
  };
  it('refuses to pick when two open transactions look identical', async () => {
    const service = makeService([
      trans('egdamax260051305', 'RP-000007', 500),
      trans('egdamax260051305', 'RP-000007', 500),
    ]);
    await expect(
      (service as any).findOpenInvoiceForJournalSettlement('m-p', base),
    ).rejects.toThrow('[INVOICE_AMBIGUOUS]');
  });
  it('picks the one transaction whose balance equals the settlement when due dates differ', async () => {
    const service = makeService([
      trans('egdamax260051305', 'RP-000007', 800, {
        DueDate: '2026-08-31T12:00:00Z',
      }),
      trans('egdamax260051305', 'RP-000007', 500),
    ]);
    const picked = await (service as any).findOpenInvoiceForJournalSettlement(
      'm-p',
      base,
    );
    expect(picked.AmountCur).toBe(-500);
  });
  it('reports a missing open transaction with its own category', async () => {
    const service = makeService([]);
    await expect(
      (service as any).findOpenInvoiceForJournalSettlement('m-p', base),
    ).rejects.toThrow('[INVOICE_NOT_FOUND]');
  });
});

describe('idempotency, D365 failures and read-back', () => {
  const lines = [supplier(10, 'A', 'Sl-000001', 912)];
  const vendTrans = [trans('INV-A', 'Sl-000001', 912)];
  const mark = (amount: number) => ({
    JournalLineCompany: 'm-p',
    JournalBatchNumber: 'Mesco-000019377',
    JournalLineNumber: 10,
    InvoiceNumber: 'INV-A',
    InvoiceCompany: 'm-p',
    InvoiceDueDate: DUE,
    SettlementAmountInInvoiceCurrency: amount,
    invoiceAccount: 'Sl-000001',
  });

  it('does not create or change a correct existing mark when a batch is retried', async () => {
    const { run, client } = harness({
      lines,
      vendTrans,
      settled: [mark(-912)],
    });
    await run([target(10, 'A', 'Sl-000001', 'INV-A', 912)]);
    expect(client.post).not.toHaveBeenCalled();
    expect(client.patch).not.toHaveBeenCalled();
  });

  it('treats a one-cent difference on an existing mark as already settled', async () => {
    const { run, client } = harness({
      lines,
      vendTrans,
      settled: [mark(-911.99)],
    });
    await run([target(10, 'A', 'Sl-000001', 'INV-A', 912)]);
    expect(client.post).not.toHaveBeenCalled();
    expect(client.patch).not.toHaveBeenCalled();
  });

  it('resumes an interrupted batch by posting only the missing mark', async () => {
    const { run, posted } = harness({
      lines: [
        supplier(10, 'A', 'Sl-000001', 912),
        supplier(12, 'B', 'Sl-000001', 912),
      ],
      vendTrans: [
        trans('INV-A', 'Sl-000001', 912),
        trans('INV-B', 'Sl-000001', 912),
      ],
      settled: [mark(-912)],
    });
    await run([
      target(10, 'A', 'Sl-000001', 'INV-A', 912),
      target(12, 'B', 'Sl-000001', 'INV-B', 912),
    ]);
    expect(posted()).toEqual([[12, 'INV-B', -912]]);
  });

  it('reports a D365 business rejection as a skipped, categorised row', async () => {
    const message =
      "Write failed for table row of type 'VendorPaymentJournalLineSettledInvoiceEntity'. Infolog: Warning: Matching record for the read only data source 'VendTrans' does not exist.";
    const { run, settled } = harness({
      lines,
      vendTrans,
      postError: new Error(message),
    });
    const skipped: any[] = [];
    const result = await run(
      [target(10, 'A', 'Sl-000001', 'INV-A', 912)],
      true,
      skipped,
    );
    expect(result).toEqual([]);
    expect(settled).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].error).toContain('[D365_SETTLEMENT_REJECTED]');
    expect(skipped[0].error).toContain("'VendTrans' does not exist");
    await expect(
      harness({ lines, vendTrans, postError: new Error(message) }).run([
        target(10, 'A', 'Sl-000001', 'INV-A', 912),
      ]),
    ).rejects.toThrow('[D365_SETTLEMENT_REJECTED]');
  });

  it('does not report success when D365 accepts the request but the read-back finds no mark', async () => {
    const { run } = harness({ lines, vendTrans, persistPost: false });
    const skipped: any[] = [];
    const result = await run(
      [target(10, 'A', 'Sl-000001', 'INV-A', 912)],
      true,
      skipped,
    );
    expect(result).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].error).toContain('[SETTLEMENT_VERIFICATION_FAILED]');
    await expect(
      harness({ lines, vendTrans, persistPost: false }).run([
        target(10, 'A', 'Sl-000001', 'INV-A', 912),
      ]),
    ).rejects.toThrow('[SETTLEMENT_VERIFICATION_FAILED]');
  });

  it('keeps settling later invoices when one is skipped (partial success is explicit)', async () => {
    const { run, posted } = harness({
      lines: [
        supplier(10, 'A', 'Sl-000001', 912),
        supplier(12, 'B', 'Sl-000001', 500),
      ],
      vendTrans: [
        trans('INV-A', 'Sl-000001', 100),
        trans('INV-B', 'Sl-000001', 500),
      ],
    });
    const skipped: any[] = [];
    await run(
      [
        target(10, 'A', 'Sl-000001', 'INV-A', 912),
        target(12, 'B', 'Sl-000001', 'INV-B', 500),
      ],
      true,
      skipped,
    );
    expect(posted()).toEqual([[12, 'INV-B', -500]]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].error).toContain('[SETTLEMENT_AMOUNT_INVALID]');
  });
});
