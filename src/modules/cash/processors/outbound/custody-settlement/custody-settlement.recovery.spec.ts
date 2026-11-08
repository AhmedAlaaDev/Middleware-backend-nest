import { toCashOutCents } from '@/modules/d365fo/services/cash-out-request-grouping';
import { CustomerPaymentJournalService } from '@/modules/d365fo/services/customer-payment-journal.service';

/**
 * Custody Settlement retry and timeout recovery.
 *
 * D365 numbers journal lines in insertion order, so a planned line number is
 * never proof that a line exists. Existing lines are recognised by content
 * (UniqueId, account type, account, currency, debit, credit); anything that
 * cannot be attributed with certainty fails closed and never re-posts.
 */
describe('Custody Settlement - recovery by D365 line identity', () => {
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
      {
        verifyVendorPaymentJournalSettlements: jest.fn().mockResolvedValue([]),
        createVendorPaymentJournalLineSettlements: jest
          .fn()
          .mockResolvedValue([]),
      } as any,
      { emit: jest.fn().mockResolvedValue(undefined) } as any,
      {
        captureExchange: jest.fn((request: unknown, response?: unknown) => ({
          ...(request === undefined ? {} : { request: { body: request } }),
          ...(response === undefined ? {} : { response: { body: response } }),
        })),
      } as any,
      { get: jest.fn().mockReturnValue({ bulkHttpTimeout: 600_000 }) } as any,
    );
    (service as any).timeoutRecoveryDelaysMs = [0];
    return { service, d365foClient, vendorPaymentJournalService };
  };

  interface Spec {
    n: number;
    id: string;
    type: 'Vendor' | 'Ledger' | 'RCash';
    account: string;
    dr?: number;
    cr?: number;
  }

  const line = (s: Spec) => ({
    dataAreaId: 'm-p',
    LineNumber: s.n,
    sourceLineNumber: 900 + s.n,
    cashDirection: 'out',
    groupInvoice: '',
    customLineApiBody: {
      journalNum: '',
      AccountNum: s.account,
      accountTypeStr: s.type,
      debitAmount: s.dr ?? 0,
      creditAmount: s.cr ?? 0,
      PAYMENTID: s.id,
      VendorGroup: '',
      currency: 'EGP',
    },
  });

  /** A balanced two-line UniqueId. */
  const pair = (id: string, first: number, amount = 100): Spec[] => [
    { n: first, id, type: 'Ledger', account: `223404|1201|${id}`, dr: amount },
    { n: first + 1, id, type: 'RCash', account: 'AlexHO EG', cr: amount },
  ];

  /** The line as D365 returns it, under D365's own line number. */
  const inD365 = (s: Spec, d365LineNumber: number) => ({
    lineNumber: d365LineNumber,
    paymentId: s.id,
    accountType: s.type === 'Vendor' ? 'Vend' : s.type,
    account: s.type === 'Ledger' ? `${s.account}|||||||||||||||` : s.account,
    currency: 'EGP',
    debitCents: toCashOutCents(s.dr),
    creditCents: toCashOutCents(s.cr),
    voucher: `V-${s.id}`,
  });

  const post = (service: CustomerPaymentJournalService, specs: Spec[]) =>
    service.postCashOutLinesForHeaderAllowingSkips(
      'JN-REC',
      specs.map(line) as any[],
      20,
      'm-p',
    );

  const sentPaymentIds = (d365foClient: { post: jest.Mock }) =>
    d365foClient.post.mock.calls.map(
      ([, body]: [string, any]) => body._contract.Lines[0].PAYMENTID,
    );

  describe('lines that already exist', () => {
    it('recognises existing lines by content when D365 numbers differ from the plan', async () => {
      const { service, d365foClient, vendorPaymentJournalService } =
        buildService();
      const a = pair('A', 1);
      const b = pair('B', 3);
      // D365 holds A completely, numbered 40 and 41 (planned: 1 and 2).
      vendorPaymentJournalService.listJournalLineDetails.mockResolvedValue([
        inD365(a[0], 40),
        inD365(a[1], 41),
      ]);

      const result = await post(service, [...a, ...b]);

      expect(sentPaymentIds(d365foClient)).toEqual(['B']);
      expect(result.skipped).toEqual([]);
      expect(result.postedLines.map((l) => l.lineNumber)).toEqual([1, 2, 3, 4]);
    });

    it('is not confused when D365 skipped line identifiers', async () => {
      const { service, d365foClient, vendorPaymentJournalService } =
        buildService();
      const a = pair('A', 1);
      // D365 line numbers are not contiguous: 3 and 9.
      vendorPaymentJournalService.listJournalLineDetails.mockResolvedValue([
        inD365(a[0], 3),
        inD365(a[1], 9),
      ]);

      await post(service, a);

      expect(d365foClient.post).not.toHaveBeenCalled();
    });

    it('posts everything when D365 holds nothing for the UniqueIds', async () => {
      const { service, d365foClient } = buildService();

      await post(service, [...pair('A', 1), ...pair('B', 3)]);

      expect(sentPaymentIds(d365foClient)).toEqual(['A', 'B']);
    });

    it('does not mistake a line of another UniqueId with the same amount for an existing line', async () => {
      const { service, d365foClient, vendorPaymentJournalService } =
        buildService();
      const other = pair('OTHER', 1, 100);
      vendorPaymentJournalService.listJournalLineDetails.mockResolvedValue([
        inD365(other[0], 1),
        inD365(other[1], 2),
      ]);

      await post(service, pair('MINE', 3, 100));

      expect(sentPaymentIds(d365foClient)).toEqual(['MINE']);
    });

    it('recovers after an application restart from D365 alone (a fresh service instance)', async () => {
      const first = buildService();
      const a = pair('A', 1);
      const b = pair('B', 3);
      // Process 1 posted A, then the application died before B.
      await post(first.service, [...a]);
      expect(sentPaymentIds(first.d365foClient)).toEqual(['A']);

      // Process 2 has no memory of process 1: it reads the journal.
      const second = buildService();
      second.vendorPaymentJournalService.listJournalLineDetails.mockResolvedValue(
        [inD365(a[0], 1), inD365(a[1], 2)],
      );
      await post(second.service, [...a, ...b]);

      expect(sentPaymentIds(second.d365foClient)).toEqual(['B']);
    });
  });

  describe('lines that cannot be attributed (fail closed)', () => {
    it('stops a UniqueId that is only partially present', async () => {
      const { service, d365foClient, vendorPaymentJournalService } =
        buildService();
      const a = pair('A', 1);
      vendorPaymentJournalService.listJournalLineDetails.mockResolvedValue([
        inD365(a[0], 12),
      ]);

      const result = await post(service, [...a, ...pair('B', 3)]);

      expect(sentPaymentIds(d365foClient)).toEqual(['B']);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          uniqueId: 'A',
          error: expect.stringContaining('only partially present'),
        }),
      ]);
    });

    it('refuses repeated identical lines when D365 holds fewer than planned', async () => {
      const { service, d365foClient, vendorPaymentJournalService } =
        buildService();
      const same: Spec[] = [
        { n: 1, id: 'R', type: 'Ledger', account: '223404|1201', dr: 10 },
        { n: 2, id: 'R', type: 'Ledger', account: '223404|1201', dr: 10 },
        { n: 3, id: 'R', type: 'Ledger', account: '223404|1201', dr: 10 },
        { n: 4, id: 'R', type: 'RCash', account: 'AlexHO EG', cr: 30 },
      ];
      // 2 of the 3 identical ledger lines exist: which one is missing is
      // unknowable, so nothing is re-posted.
      vendorPaymentJournalService.listJournalLineDetails.mockResolvedValue([
        inD365(same[0], 5),
        inD365(same[1], 6),
      ]);

      const result = await post(service, same);

      expect(d365foClient.post).not.toHaveBeenCalled();
      expect(result.skipped).toEqual([
        expect.objectContaining({
          uniqueId: 'R',
          error: expect.stringContaining('[JOURNAL_RECOVERY_AMBIGUOUS]'),
        }),
      ]);
    });

    it('refuses when D365 holds MORE identical lines than planned (a duplicate)', async () => {
      const { service, d365foClient, vendorPaymentJournalService } =
        buildService();
      const a = pair('A', 1);
      vendorPaymentJournalService.listJournalLineDetails.mockResolvedValue([
        inD365(a[0], 1),
        inD365(a[0], 2),
        inD365(a[1], 3),
      ]);

      const result = await post(service, a);

      expect(d365foClient.post).not.toHaveBeenCalled();
      expect(result.skipped).toEqual([
        expect.objectContaining({
          uniqueId: 'A',
          error: expect.stringContaining('[JOURNAL_RECOVERY_AMBIGUOUS]'),
        }),
      ]);
    });

    it('treats repeated identical lines as present when D365 holds exactly the planned count', async () => {
      const { service, d365foClient, vendorPaymentJournalService } =
        buildService();
      const same: Spec[] = [
        { n: 1, id: 'R', type: 'Ledger', account: '223404|1201', dr: 10 },
        { n: 2, id: 'R', type: 'Ledger', account: '223404|1201', dr: 10 },
        { n: 3, id: 'R', type: 'RCash', account: 'AlexHO EG', cr: 20 },
      ];
      vendorPaymentJournalService.listJournalLineDetails.mockResolvedValue([
        inD365(same[0], 8),
        inD365(same[1], 9),
        inD365(same[2], 10),
      ]);

      const result = await post(service, same);

      expect(d365foClient.post).not.toHaveBeenCalled();
      expect(result.skipped).toEqual([]);
    });

    it('reports a source line without a payment ID instead of posting it', async () => {
      const { service, d365foClient } = buildService();
      const orphan = { ...line(pair('X', 1)[0]) } as any;
      orphan.customLineApiBody.PAYMENTID = '';

      const result = await service.postCashOutLinesForHeaderAllowingSkips(
        'JN-REC',
        [orphan, ...pair('B', 3).map(line)] as any[],
        20,
        'm-p',
      );

      expect(sentPaymentIds(d365foClient)).toEqual(['B']);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          error: expect.stringContaining('missing PAYMENTID'),
        }),
      ]);
    });

    it('stops before posting when the journal cannot be read from D365', async () => {
      const { service, d365foClient, vendorPaymentJournalService } =
        buildService();
      vendorPaymentJournalService.listJournalLineDetails.mockRejectedValue(
        new Error('OData unavailable'),
      );

      await expect(post(service, pair('A', 1))).rejects.toThrow(
        '[JOURNAL_READBACK_FAILED]',
      );
      expect(d365foClient.post).not.toHaveBeenCalled();
    });
  });

  describe('client timeout while D365 may have committed', () => {
    const timeout = () => new Error('timeout of 600000ms exceeded');

    it('does not re-send when D365 committed the request (numbers differ from the plan)', async () => {
      const { service, d365foClient, vendorPaymentJournalService } =
        buildService();
      const a = pair('A', 1);
      vendorPaymentJournalService.listJournalLineDetails
        .mockResolvedValueOnce([]) // before posting
        .mockResolvedValue([inD365(a[0], 31), inD365(a[1], 32)]); // after timeout
      d365foClient.post.mockRejectedValueOnce(timeout());

      const result = await post(service, a);

      expect(d365foClient.post).toHaveBeenCalledTimes(1);
      expect(result.skipped).toEqual([]);
      expect(result.postedLines).toHaveLength(2);
    });

    it('raises the timeout when D365 did not commit anything', async () => {
      const { service, d365foClient } = buildService();
      d365foClient.post.mockRejectedValueOnce(timeout());

      const result = await post(service, pair('A', 1));

      expect(d365foClient.post).toHaveBeenCalledTimes(1);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          uniqueId: 'A',
          error: expect.stringContaining('timeout of 600000ms exceeded'),
        }),
      ]);
      expect(result.postedLines).toEqual([]);
    });

    it('stops with [JOURNAL_RECOVERY_AMBIGUOUS] when D365 holds only part of the request', async () => {
      const { service, d365foClient, vendorPaymentJournalService } =
        buildService();
      const a = pair('A', 1);
      vendorPaymentJournalService.listJournalLineDetails
        .mockResolvedValueOnce([])
        .mockResolvedValue([inD365(a[0], 31)]);
      d365foClient.post.mockRejectedValueOnce(timeout());

      const result = await post(service, a);

      expect(d365foClient.post).toHaveBeenCalledTimes(1);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          error: expect.stringContaining('[JOURNAL_RECOVERY_AMBIGUOUS]'),
        }),
      ]);
    });

    it('counts what earlier requests of the run already put in D365', async () => {
      const { service, d365foClient, vendorPaymentJournalService } =
        buildService();
      // Two UniqueIds whose lines are IDENTICAL except for the UniqueId.
      const a = pair('A', 1, 50);
      const b = pair('B', 3, 50);
      d365foClient.post
        .mockResolvedValueOnce({ StatusCode: 'Success', Message: 'ok' })
        .mockRejectedValueOnce(timeout());
      vendorPaymentJournalService.listJournalLineDetails
        .mockResolvedValueOnce([]) // before posting
        .mockResolvedValue([
          inD365(a[0], 1),
          inD365(a[1], 2),
          inD365(b[0], 3),
          inD365(b[1], 4),
        ]); // after B's timeout: A (earlier request) + B (committed)

      const result = await post(service, [...a, ...b]);

      expect(d365foClient.post).toHaveBeenCalledTimes(2);
      expect(result.skipped).toEqual([]);
    });
  });

  describe('other workflows keep their logic', () => {
    it('does not read the journal details for a non-Custody cash-out upload', async () => {
      const { service, d365foClient, vendorPaymentJournalService } =
        buildService();
      const lines = pair('VP', 1).map((s) => line({ ...s })) as any[];
      lines.forEach((l) => {
        l.customLineApiBody.OffsetAccountTypeStr = 'Bank';
      });

      await service.postCashOutLinesForHeader('JN-VP', lines, 20, 'm-p');

      expect(d365foClient.post).toHaveBeenCalledTimes(1);
      expect(
        vendorPaymentJournalService.listJournalLineDetails,
      ).not.toHaveBeenCalled();
      expect(vendorPaymentJournalService.listLinesForHeader).toHaveBeenCalled();
    });
  });
});
