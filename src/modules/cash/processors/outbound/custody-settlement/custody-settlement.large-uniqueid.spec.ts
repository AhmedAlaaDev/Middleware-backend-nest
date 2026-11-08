import {
  simulateCashOutVouchers,
  toCashOutCents,
} from '@/modules/d365fo/services/cash-out-request-grouping';
import { CustomerPaymentJournalService } from '@/modules/d365fo/services/customer-payment-journal.service';

/**
 * Large Custody Settlement UniqueIds.
 *
 * D365 assigns vouchers per X++ request (TSLedgerJournalIntegration): lines
 * without an offset share a voucher until debit equals credit. A request that
 * does not balance on its own therefore lands in an unbalanced voucher. These
 * tests drive the real posting service (mocked D365 client) with shapes taken
 * from the Custody Settlement workbook (e.g. UniqueId 534844: 646 Ledger,
 * 85 Vendor and 1 Petty Cash row, balanced overall).
 */
describe('Custody Settlement - large UniqueIds', () => {
  const buildService = () => {
    const d365foClient = {
      post: jest.fn().mockResolvedValue({
        StatusCode: 'Success',
        Message: 'Success',
      }),
      get: jest.fn().mockResolvedValue({ value: [] }),
      delete: jest.fn(),
      patch: jest.fn(),
    };
    const vendorPaymentJournalService = {
      listLinesForHeader: jest.fn().mockResolvedValue([]),
      listJournalLineDetails: jest.fn().mockResolvedValue([]),
      updateLineFinancialTags: jest.fn().mockResolvedValue(undefined),
      updateLineDescription: jest.fn().mockResolvedValue(undefined),
    };
    const vendorInvoiceJournalService = {
      verifyVendorPaymentJournalSettlements: jest.fn().mockResolvedValue([]),
      createVendorPaymentJournalLineSettlements: jest
        .fn()
        .mockResolvedValue([]),
    };
    const service = new CustomerPaymentJournalService(
      d365foClient as any,
      {
        and: jest.fn(),
        eq: jest.fn(),
        or: jest.fn(),
        buildQuery: jest.fn(),
      } as any,
      {
        executeWithRetry: jest.fn((fn: any) => fn()),
        configureAxiosRetry: jest.fn(),
      } as any,
      {
        extractMessage: jest.fn(
          (e: unknown) => (e as any)?.message ?? String(e),
        ),
        normalize: jest.fn(() => ({ isConcurrencyConflict: false })),
      } as any,
      vendorPaymentJournalService as any,
      vendorInvoiceJournalService as any,
      { emit: jest.fn().mockResolvedValue(undefined) } as any,
      {
        captureExchange: jest.fn((request: unknown, response?: unknown) => ({
          ...(request === undefined ? {} : { request: { body: request } }),
          ...(response === undefined ? {} : { response: { body: response } }),
        })),
      } as any,
      { get: jest.fn().mockReturnValue({ bulkHttpTimeout: 600_000 }) } as any,
    );
    return { service, d365foClient, vendorPaymentJournalService };
  };

  interface Spec {
    n: number;
    id: string;
    type: 'Vendor' | 'Ledger' | 'RCash';
    dr?: number;
    cr?: number;
    invoice?: string;
    account?: string;
    offset?: string;
    currency?: string;
    sourceLine?: number;
  }

  const line = (s: Spec) => ({
    dataAreaId: 'm-p',
    LineNumber: s.n,
    sourceLineNumber: s.sourceLine ?? s.n,
    cashDirection: 'out',
    groupInvoice: s.invoice ?? '',
    customLineApiBody: {
      journalNum: '',
      AccountNum: s.account ?? `ACC-${s.n}`,
      accountTypeStr: s.type,
      debitAmount: s.dr ?? 0,
      creditAmount: s.cr ?? 0,
      PAYMENTID: s.id,
      VendorGroup: s.type === 'Vendor' ? 'Custody' : '',
      currency: s.currency ?? 'EGP',
      ...(s.offset ? { OffsetAccountTypeStr: s.offset } : {}),
      ...(s.invoice
        ? {
            MarkedLines: [
              {
                InvoiceNumber: s.invoice,
                OperationNumber: 'OP-1',
                DocumentNumber: 'DOC-1',
                HasWithHoldingLine: false,
              },
            ],
          }
        : {}),
    },
  });

  /**
   * A balanced Custody UniqueId shaped like the workbook: many Ledger debits,
   * Vendor credits (each with its own invoice, so each invoice group is
   * one-sided) and one Petty Cash credit that balances the group in cents.
   */
  const bigUniqueId = (
    id: string,
    firstLine: number,
    totalLines: number,
    options: { vendors?: number } = {},
  ): Spec[] => {
    const vendors = options.vendors ?? Math.max(1, Math.round(totalLines / 9));
    const ledgers = totalLines - vendors - 1;
    const specs: Spec[] = [];
    let n = firstLine;
    let debitCents = 0;
    for (let i = 0; i < ledgers; i++) {
      const cents = ((i * 37) % 9000) + 100;
      debitCents += cents;
      specs.push({ n: n++, id, type: 'Ledger', dr: cents / 100 });
    }
    let vendorCents = 0;
    for (let v = 0; v < vendors; v++) {
      const cents = Math.floor(debitCents / (vendors * 2)) + v;
      vendorCents += cents;
      specs.push({
        n: n++,
        id,
        type: 'Vendor',
        cr: cents / 100,
        invoice: v % 3 === 0 ? '' : `INV-${id}-${v}`,
      });
    }
    specs.push({
      n: n++,
      id,
      type: 'RCash',
      cr: (debitCents - vendorCents) / 100,
    });
    return specs;
  };

  /** What D365 returns for a posted spec line (its own line number). */
  const actualLine = (s: Spec, d365LineNumber: number) => ({
    lineNumber: d365LineNumber,
    paymentId: s.id,
    accountType: s.type === 'Vendor' ? 'Vend' : s.type,
    account: s.account ?? `ACC-${s.n}`,
    currency: s.currency ?? 'EGP',
    debitCents: toCashOutCents(s.dr),
    creditCents: toCashOutCents(s.cr),
    voucher: `V-${s.id}`,
  });

  const netCents = (specs: Spec[]) =>
    specs.reduce(
      (sum, s) => sum + toCashOutCents(s.dr) - toCashOutCents(s.cr),
      0,
    );

  const requestsOf = (d365foClient: { post: jest.Mock }) =>
    d365foClient.post.mock.calls.map(
      ([, body]: [string, any]) => body._contract.Lines as any[],
    );

  const post = (service: CustomerPaymentJournalService, specs: Spec[]) =>
    service.postCashOutLinesForHeaderAllowingSkips(
      'JN-LARGE',
      specs.map(line) as any[],
      20,
      'm-p',
    );

  const sendOrder = (request: any[]) =>
    request.map((row) => String(row.AccountNum));

  const asVouchers = (request: any[]) =>
    simulateCashOutVouchers(
      request.map((row) => ({
        offsetless: !String(row.OffsetAccountTypeStr ?? '').trim(),
        debitCents: toCashOutCents(row.DebitAmount),
        creditCents: toCashOutCents(row.CreditAmount),
      })),
    );

  describe('one UniqueId is one balanced request', () => {
    it.each([2, 9, 100, 500, 732, 1200])(
      'posts a %i-line UniqueId in a single request with every line once',
      async (total) => {
        const { service, d365foClient } = buildService();
        const specs = bigUniqueId('534844', 2404, Math.max(total, 3), {
          vendors: total <= 2 ? 1 : undefined,
        });
        const input = total === 2 ? specs.slice(1) : specs;
        // A 2-line group: one Ledger debit + one Petty Cash credit.
        const group =
          total === 2
            ? [
                { n: 1, id: 'U2', type: 'Ledger', dr: 10 } as Spec,
                { n: 2, id: 'U2', type: 'RCash', cr: 10 } as Spec,
              ]
            : input;
        expect(netCents(group)).toBe(0);

        const result = await post(service, group);

        const requests = requestsOf(d365foClient);
        expect(requests).toHaveLength(1);
        expect(requests[0]).toHaveLength(group.length);
        expect(sendOrder(requests[0])).toEqual(
          group.map((s) => s.account ?? `ACC-${s.n}`),
        );
        expect(asVouchers(requests[0]).openLines).toBe(0);
        expect(result.postedLines).toHaveLength(group.length);
        expect(result.skipped).toEqual([]);
      },
    );

    it('keeps UniqueId 534844-shaped group (646 Ledger / 85 Vendor / 1 Petty Cash) whole and balanced', async () => {
      const { service, d365foClient } = buildService();
      const specs = bigUniqueId('534844', 2404, 732, { vendors: 85 });
      expect(specs).toHaveLength(732);
      expect(specs.filter((s) => s.type === 'Ledger')).toHaveLength(646);
      expect(specs.filter((s) => s.type === 'Vendor')).toHaveLength(85);
      expect(netCents(specs)).toBe(0);

      await post(service, specs);

      const requests = requestsOf(d365foClient);
      // Many vendor rows carry their own (one-sided) invoice. The old logic
      // sent each of them as a separate, unbalanced request.
      expect(requests).toHaveLength(1);
      expect(requests[0]).toHaveLength(732);
      expect(asVouchers(requests[0])).toEqual({
        vouchers: 1,
        openLines: 0,
        openNetCents: 0,
      });
    });

    it('does not split or drop a group larger than 1,000 lines', async () => {
      const { service, d365foClient } = buildService();
      const specs = bigUniqueId('BIG', 1, 1500);

      const result = await post(service, specs);

      const requests = requestsOf(d365foClient);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toHaveLength(1500);
      expect(result.postedLines).toHaveLength(1500);
    });
  });

  describe('large group among other groups', () => {
    it('keeps a large group intact between small groups and crossing a normal chunk boundary', async () => {
      const { service, d365foClient } = buildService();
      const small = (id: string, first: number): Spec[] => [
        { n: first, id, type: 'Ledger', dr: 25 },
        { n: first + 1, id, type: 'RCash', cr: 25 },
      ];
      const specs = [
        ...small('A', 1),
        ...small('B', 3),
        ...bigUniqueId('LARGE', 5, 250),
        ...small('C', 255),
        ...small('D', 257),
      ];

      const result = await post(service, specs);

      const requests = requestsOf(d365foClient);
      // Groups holding a Custody vendor are sent first (existing rule); every
      // group stays whole and in source order.
      expect(requests.map((r) => r.length)).toEqual([250, 2, 2, 2, 2]);
      expect(requests[0].every((row) => row.PAYMENTID === 'LARGE')).toBe(true);
      expect(asVouchers(requests[0]).openLines).toBe(0);
      expect(requests.slice(1).map((request) => request[0].PAYMENTID)).toEqual([
        'A',
        'B',
        'C',
        'D',
      ]);
      const sent = requests.flat().length;
      expect(sent).toBe(specs.length);
      expect(result.postedLines).toHaveLength(specs.length);
    });

    it('never mixes lines of different UniqueIds, even with repeated source LINENUMBERs and amounts', async () => {
      const { service, d365foClient } = buildService();
      // Source LINENUMBER values repeat across UniqueIds in real workbooks.
      const pair = (id: string, first: number): Spec[] => [
        { n: first, id, type: 'Ledger', dr: 100, sourceLine: 7 },
        { n: first + 1, id, type: 'RCash', cr: 100, sourceLine: 8 },
      ];

      const result = await post(service, [
        ...pair('X1', 1),
        ...pair('X2', 3),
        ...pair('X3', 5),
      ]);

      const requests = requestsOf(d365foClient);
      expect(requests).toHaveLength(3);
      expect(
        requests.map((request) => [
          ...new Set(request.map((row) => row.PAYMENTID)),
        ]),
      ).toEqual([['X1'], ['X2'], ['X3']]);
      expect(result.postedLines.map((l) => l.lineNumber)).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
    });
  });

  describe('per-invoice requests', () => {
    const invoicePair = (
      id: string,
      first: number,
      invoice: string,
      amount: number,
    ): Spec[] => [
      { n: first, id, type: 'Vendor', cr: amount, invoice, account: 'CUS' },
      { n: first + 1, id, type: 'Vendor', dr: amount, invoice, account: 'SUP' },
    ];

    it('splits off only invoice groups that balance on their own, in source order', async () => {
      const { service, d365foClient } = buildService();
      const main: Spec[] = [
        { n: 1, id: 'U', type: 'Ledger', dr: 500 },
        { n: 2, id: 'U', type: 'Vendor', cr: 100, invoice: 'ONE-SIDED' },
        { n: 3, id: 'U', type: 'RCash', cr: 400 },
      ];
      const specs = [
        ...main,
        ...invoicePair('U', 4, 'BAL-1', 50),
        ...invoicePair('U', 6, 'BAL-2', 70.25),
      ];

      await post(service, specs);

      const requests = requestsOf(d365foClient);
      expect(requests).toHaveLength(3);
      expect(
        requests.map((request) =>
          request.map((row) => row.MarkedLines?.[0]?.InvoiceNumber ?? ''),
        ),
      ).toEqual([
        ['', 'ONE-SIDED', ''],
        ['BAL-1', 'BAL-1'],
        ['BAL-2', 'BAL-2'],
      ]);
      for (const request of requests) {
        expect(asVouchers(request).openLines).toBe(0);
      }
    });

    it('keeps one-sided invoice groups of a UniqueId together in source order', async () => {
      const { service, d365foClient } = buildService();
      const specs: Spec[] = [
        { n: 1, id: 'U', type: 'Vendor', cr: 10, invoice: 'I-1' },
        { n: 2, id: 'U', type: 'Ledger', dr: 100 },
        { n: 3, id: 'U', type: 'Vendor', cr: 20, invoice: 'I-2' },
        { n: 4, id: 'U', type: 'Vendor', cr: 30, invoice: 'I-3' },
        { n: 5, id: 'U', type: 'RCash', cr: 40 },
      ];

      await post(service, specs);

      const requests = requestsOf(d365foClient);
      expect(requests).toHaveLength(1);
      expect(
        requests[0].map((row) => row.CreditAmount || row.DebitAmount),
      ).toEqual([10, 100, 20, 30, 40]);
    });

    it.each(['0', '00', '000'])(
      'treats the %p invoice placeholder as part of the main request',
      async (placeholder) => {
        const { service, d365foClient } = buildService();
        const specs: Spec[] = [
          { n: 1, id: 'U', type: 'Vendor', cr: 10, invoice: placeholder },
          { n: 2, id: 'U', type: 'Vendor', dr: 10, invoice: placeholder },
          { n: 3, id: 'U', type: 'Ledger', dr: 5 },
          { n: 4, id: 'U', type: 'RCash', cr: 5 },
        ];

        await post(service, specs);

        const requests = requestsOf(d365foClient);
        expect(requests).toHaveLength(1);
        expect(requests[0]).toHaveLength(4);
      },
    );

    it('handles several vendors under one invoice as one balanced group', async () => {
      const { service, d365foClient } = buildService();
      const specs: Spec[] = [
        {
          n: 1,
          id: 'U',
          type: 'Vendor',
          cr: 60,
          invoice: 'SHARED',
          account: 'V1',
        },
        {
          n: 2,
          id: 'U',
          type: 'Vendor',
          cr: 40,
          invoice: 'SHARED',
          account: 'V2',
        },
        {
          n: 3,
          id: 'U',
          type: 'Vendor',
          dr: 100,
          invoice: 'SHARED',
          account: 'V3',
        },
        { n: 4, id: 'U', type: 'Ledger', dr: 9 },
        { n: 5, id: 'U', type: 'RCash', cr: 9 },
      ];

      await post(service, specs);

      const requests = requestsOf(d365foClient);
      expect(requests).toHaveLength(2);
      expect(requests.map((r) => r.length).sort()).toEqual([2, 3]);
    });
  });

  describe('decimal precision', () => {
    it('balances repeated identical sub-unit amounts exactly (0.1 x 30 = 3)', async () => {
      const { service, d365foClient } = buildService();
      const specs: Spec[] = [
        ...Array.from({ length: 30 }, (_, i) => ({
          n: i + 1,
          id: 'DEC',
          type: 'Ledger' as const,
          dr: 0.1,
        })),
        { n: 31, id: 'DEC', type: 'RCash', cr: 3 },
      ];

      const result = await post(service, specs);

      expect(requestsOf(d365foClient)).toHaveLength(1);
      expect(result.skipped).toEqual([]);
    });

    it('accepts a one-cent source rounding difference like the X++ voucher rule', async () => {
      const { service, d365foClient } = buildService();

      await post(service, [
        { n: 1, id: 'U', type: 'Ledger', dr: 10.01 },
        { n: 2, id: 'U', type: 'RCash', cr: 10 },
      ]);

      expect(requestsOf(d365foClient)).toHaveLength(1);
    });
  });

  describe('integrity guard', () => {
    it('does not send an unbalanced request, reports it, and continues with later UniqueIds', async () => {
      const { service, d365foClient } = buildService();
      const specs: Spec[] = [
        { n: 1, id: 'BAD', type: 'Ledger', dr: 100, sourceLine: 11 },
        { n: 2, id: 'BAD', type: 'RCash', cr: 90, sourceLine: 12 },
        { n: 3, id: 'GOOD', type: 'Ledger', dr: 50, sourceLine: 13 },
        { n: 4, id: 'GOOD', type: 'RCash', cr: 50, sourceLine: 14 },
      ];

      const result = await post(service, specs);

      const requests = requestsOf(d365foClient);
      expect(requests).toHaveLength(1);
      expect(requests[0].every((row) => row.PAYMENTID === 'GOOD')).toBe(true);
      expect(result.postedLines.map((l) => l.lineNumber)).toEqual([3, 4]);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          uniqueId: 'BAD',
          excelLineNumbers: [11, 12],
          error: expect.stringContaining('[JOURNAL_IMBALANCE]'),
        }),
      ]);
    });

    it('does not block a request that mixes currencies (balanced in accounting currency)', async () => {
      const { service, d365foClient } = buildService();

      await post(service, [
        { n: 1, id: 'FX', type: 'Ledger', dr: 4875, currency: 'EGP' },
        { n: 2, id: 'FX', type: 'RCash', cr: 100, currency: 'USD' },
      ]);

      expect(requestsOf(d365foClient)).toHaveLength(1);
    });

    it('treats a failed request as a whole-UniqueId skip and posts nothing from it', async () => {
      const { service, d365foClient } = buildService();
      d365foClient.post
        .mockResolvedValueOnce({
          StatusCode: 'Error',
          Message: 'Dimension combination is not valid.',
        })
        .mockResolvedValue({ StatusCode: 'Success', Message: 'ok' });
      const big = bigUniqueId('FAIL', 1, 300);
      const next: Spec[] = [
        { n: 301, id: 'NEXT', type: 'Ledger', dr: 5 },
        { n: 302, id: 'NEXT', type: 'RCash', cr: 5 },
      ];

      const result = await post(service, [...big, ...next]);

      expect(d365foClient.post).toHaveBeenCalledTimes(2);
      expect(result.postedLines.map((l) => l.lineNumber)).toEqual([301, 302]);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          uniqueId: 'FAIL',
          phase: 'post',
          d365LineNumbers: big.map((s) => s.n),
        }),
      ]);
    });

    it('stops a retry from resuming a partially present UniqueId', async () => {
      const { service, d365foClient, vendorPaymentJournalService } =
        buildService();
      const big = bigUniqueId('PARTIAL', 1, 40);
      // 15 of its 40 lines already exist in D365, under D365's own line
      // numbers (100+), which differ from the planned ones (1..15).
      vendorPaymentJournalService.listJournalLineDetails.mockResolvedValue(
        big.slice(0, 15).map((s, index) => actualLine(s, 100 + index)),
      );

      const result = await post(service, [
        ...big,
        { n: 41, id: 'OK', type: 'Ledger', dr: 1 },
        { n: 42, id: 'OK', type: 'RCash', cr: 1 },
      ]);

      const requests = requestsOf(d365foClient);
      expect(requests).toHaveLength(1);
      expect(requests[0].every((row) => row.PAYMENTID === 'OK')).toBe(true);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          uniqueId: 'PARTIAL',
          error: expect.stringContaining('only partially present'),
        }),
      ]);
    });
  });

  describe('Vendor Payment is unchanged', () => {
    it('keeps one request per UniqueId without splitting by invoice or balancing offset lines', async () => {
      const { service, d365foClient } = buildService();
      const lines = [
        line({
          n: 1,
          id: 'VP1',
          type: 'Vendor',
          dr: 100,
          invoice: 'I-1',
          offset: 'Bank',
        }),
        line({
          n: 2,
          id: 'VP1',
          type: 'Vendor',
          dr: 200,
          invoice: 'I-2',
          offset: 'Bank',
        }),
        line({
          n: 3,
          id: 'VP2',
          type: 'Vendor',
          dr: 300,
          invoice: 'I-3',
          offset: 'Bank',
        }),
      ];

      const result = await service.postCashOutLinesForHeader(
        'JN-VP',
        lines as any[],
        20,
        'm-p',
      );

      const requests = requestsOf(d365foClient);
      expect(requests.map((r) => r.length)).toEqual([2, 1]);
      expect(result).toHaveLength(3);
    });
  });
});
