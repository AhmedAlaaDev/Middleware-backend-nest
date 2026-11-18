import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

import {
  isYardInvoiceSettlementEnabled,
  planYardSettlements,
  YardInvoiceSettlementService,
  YardJournalLine,
  YardOpenInvoice,
} from './yard-invoice-settlement.service';

const COMPANY = 'm-p';
const JOURNAL = 'Mesco-000020052';

function line(
  lineNumber: number,
  invoice: string,
  amount = 1370,
): YardJournalLine {
  return {
    LineNumber: lineNumber,
    TransactionText: `Yard receipt ${invoice}`,
    AccountDisplayValue: '101011024',
    CreditAmount: amount,
    DebitAmount: 0,
    CurrencyCode: 'EGP',
  };
}

function open(
  invoice: string,
  amount = 1370,
  overrides: Partial<YardOpenInvoice> = {},
): YardOpenInvoice {
  return {
    Invoice: invoice,
    AccountNum: '101011024',
    CurrencyCode: 'EGP',
    AmountCur: amount,
    SettleAmountCur: 0,
    Voucher: `Rev-${invoice}`,
    Closed: '1900-01-01T00:00:00Z',
    DueDate: '2026-07-01T12:00:00Z',
    ...overrides,
  };
}

/** Fake D365: serves the journal lines, existing settlements and open invoices, and records writes. */
function fakeD365(options: {
  lines: YardJournalLine[];
  invoices: YardOpenInvoice[];
  alreadySettled?: number[];
  failPostsAfter?: number;
}) {
  const settled: Array<{
    JournalLineNumber: number;
    SettlementAmountInInvoiceCurrency: number;
  }> = (options.alreadySettled ?? []).map((n) => ({
    JournalLineNumber: n,
    SettlementAmountInInvoiceCurrency: 1370,
  }));
  const posts: Array<{
    endpoint: string;
    body: Record<string, unknown>;
    options: unknown;
  }> = [];
  const get = jest.fn((endpoint: string) => {
    if (endpoint.startsWith('/data/CustomerPaymentJournalLines')) {
      return Promise.resolve({ value: options.lines });
    }
    if (endpoint.startsWith('/data/CustTransBiEntities')) {
      return Promise.resolve({ value: options.invoices });
    }
    if (endpoint.startsWith('/data/PaymentJournalLineSettledInvoices')) {
      return Promise.resolve({ value: settled });
    }
    return Promise.reject(new Error(`unexpected endpoint ${endpoint}`));
  });
  const post = jest.fn(
    (endpoint: string, body: Record<string, unknown>, opts: unknown) => {
      const index = posts.length;
      posts.push({ endpoint, body, options: opts });
      if (
        options.failPostsAfter !== undefined &&
        index >= options.failPostsAfter
      ) {
        return Promise.reject(new Error('503 from D365'));
      }
      settled.push({
        JournalLineNumber: Number(body.JournalLineNumber),
        SettlementAmountInInvoiceCurrency: Number(
          body.SettlementAmountInInvoiceCurrency,
        ),
      });
      return Promise.resolve({});
    },
  );
  const client = { get, post } as unknown as D365FOClientService;
  const service = new YardInvoiceSettlementService(
    client,
    new ODataQueryBuilderService(),
  );
  return { service, get, post, posts, settled };
}

describe('isYardInvoiceSettlementEnabled', () => {
  it('is off unless the flag is exactly true', () => {
    expect(isYardInvoiceSettlementEnabled({})).toBe(false);
    expect(
      isYardInvoiceSettlementEnabled({
        YARD_INVOICE_SETTLEMENT_ENABLED: 'false',
      }),
    ).toBe(false);
    expect(
      isYardInvoiceSettlementEnabled({
        YARD_INVOICE_SETTLEMENT_ENABLED: 'true',
      }),
    ).toBe(true);
  });
});

describe('planYardSettlements', () => {
  it('plans one settlement per receipt when every receipt matches one open invoice', () => {
    const lines = [line(1, 'INV-1'), line(2, 'INV-2')];
    const byInvoice = new Map([
      ['INV-1', [open('INV-1')]],
      ['INV-2', [open('INV-2')]],
    ]);
    const { plan, problems } = planYardSettlements(lines, byInvoice);
    expect(problems).toEqual([]);
    expect(plan).toEqual([
      {
        journalLineNumber: 1,
        invoiceNumber: 'INV-1',
        amount: 1370,
        dueDate: '2026-07-01T12:00:00Z',
      },
      {
        journalLineNumber: 2,
        invoiceNumber: 'INV-2',
        amount: 1370,
        dueDate: '2026-07-01T12:00:00Z',
      },
    ]);
  });

  it('returns no plan when any receipt does not match, so nothing is settled', () => {
    const lines = [line(1, 'INV-1'), line(2, 'INV-2', 999)];
    const byInvoice = new Map([
      ['INV-1', [open('INV-1')]],
      ['INV-2', [open('INV-2')]],
    ]);
    const { plan, problems } = planYardSettlements(lines, byInvoice);
    expect(plan).toEqual([]);
    expect(problems).toEqual([
      expect.stringMatching(/^INV-2 \(line 2\): receipt 999 vs open 1370/),
    ]);
  });

  it('flags a customer mismatch and an ambiguous invoice', () => {
    const lines = [line(1, 'INV-1'), line(2, 'INV-2')];
    const byInvoice = new Map([
      ['INV-1', [open('INV-1', 1370, { AccountNum: '999' })]],
      ['INV-2', [open('INV-2'), open('INV-2')]],
    ]);
    const { plan, problems } = planYardSettlements(lines, byInvoice);
    expect(plan).toEqual([]);
    expect(problems.join(' ')).toMatch(/customer 101011024 vs invoice 999/);
    expect(problems.join(' ')).toMatch(
      /INV-2: 2 open invoice rows \(ambiguous\)/,
    );
  });

  it('ignores closed and payment-side rows when matching', () => {
    const lines = [line(1, 'INV-1')];
    const byInvoice = new Map([
      [
        'INV-1',
        [
          open('INV-1', 1370, { Closed: '2026-07-02T00:00:00Z' }),
          open('INV-1', -1370),
        ],
      ],
    ]);
    const { problems } = planYardSettlements(lines, byInvoice);
    expect(problems).toEqual(['INV-1: no open invoice in D365']);
  });
});

describe('YardInvoiceSettlementService', () => {
  it('settles every receipt, writes without retries, and verifies the settled total', async () => {
    const lines = [line(1, 'INV-1'), line(2, 'INV-2')];
    const ctx = fakeD365({ lines, invoices: [open('INV-1'), open('INV-2')] });

    const report = await ctx.service.settleJournal({
      company: COMPANY,
      journalBatchNumber: JOURNAL,
    });

    expect(report).toMatchObject({
      yardLines: 2,
      toSettle: 2,
      settled: 2,
      failed: 0,
      stoppedEarly: false,
    });
    expect(report.verifiedRows).toBe(2);
    expect(report.verifiedTotal).toBe(2740);
    expect(ctx.posts[0].body).toMatchObject({
      JournalLineCompany: COMPANY,
      JournalBatchNumber: JOURNAL,
      JournalLineNumber: 1,
      InvoiceNumber: 'INV-1',
      InvoiceCompany: COMPANY,
      SettlementAmountInInvoiceCurrency: 1370,
    });
    expect(
      ctx.posts.every((p) => (p.options as { retries: number }).retries === 0),
    ).toBe(true);
  });

  it('writes nothing when any receipt fails the match', async () => {
    const lines = [line(1, 'INV-1'), line(2, 'INV-2', 999)];
    const ctx = fakeD365({ lines, invoices: [open('INV-1'), open('INV-2')] });

    const report = await ctx.service.settleJournal({
      company: COMPANY,
      journalBatchNumber: JOURNAL,
    });

    expect(ctx.post).not.toHaveBeenCalled();
    expect(report).toMatchObject({ toSettle: 0, settled: 0 });
    expect(report.problems).toHaveLength(1);
  });

  it('skips receipts that are already settled, so a retried job does not settle them twice', async () => {
    const lines = [line(1, 'INV-1'), line(2, 'INV-2')];
    const ctx = fakeD365({
      lines,
      invoices: [open('INV-1'), open('INV-2')],
      alreadySettled: [1],
    });

    const report = await ctx.service.settleJournal({
      company: COMPANY,
      journalBatchNumber: JOURNAL,
    });

    expect(report).toMatchObject({
      alreadySettled: 1,
      toSettle: 1,
      settled: 1,
    });
    expect(ctx.posts).toHaveLength(1);
    expect(ctx.posts[0].body.JournalLineNumber).toBe(2);
  });

  it('stops after three failures in a row and reports the run as stopped early', async () => {
    const lines = [
      line(1, 'INV-1'),
      line(2, 'INV-2'),
      line(3, 'INV-3'),
      line(4, 'INV-4'),
    ];
    const invoices = ['INV-1', 'INV-2', 'INV-3', 'INV-4'].map((n) => open(n));
    const ctx = fakeD365({ lines, invoices, failPostsAfter: 0 });

    const report = await ctx.service.settleJournal({
      company: COMPANY,
      journalBatchNumber: JOURNAL,
    });

    expect(ctx.post).toHaveBeenCalledTimes(3);
    expect(report).toMatchObject({ failed: 3, settled: 0, stoppedEarly: true });
  });
});
