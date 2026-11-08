import {
  ActualJournalLine,
  PlannedJournalLine,
} from './cash-journal-line-identity';
import {
  formatJournalIntegrityFailure,
  verifyJournalContent,
  verifyJournalContentDetailed,
} from './cash-journal-readback';

/**
 * Post-write verification compares the ACTUAL journal (every D365 line) with
 * the EXPECTED journal line by line. Counts and totals alone are not enough:
 * the "same total" cases below would pass a count/sum check.
 */
describe('verifyJournalContent', () => {
  const LEDGER =
    '223404|1201|012|001|001|301000002|301000002|3066|3066|16517|MESCO CC ALEX|3115|Payable|||EXPORT||||';

  const planned = (
    lineNumber: number,
    overrides: Partial<PlannedJournalLine> = {},
  ): PlannedJournalLine => ({
    lineNumber,
    paymentId: 'U1',
    accountType: 'Vendor',
    account: 'Sl-000036',
    currency: 'EGP',
    debitCents: 10000,
    creditCents: 0,
    offsetless: true,
    ...overrides,
  });

  const actual = (
    lineNumber: number,
    overrides: Partial<ActualJournalLine> = {},
  ): ActualJournalLine => ({
    lineNumber,
    paymentId: 'U1',
    accountType: 'Vend',
    account: 'Sl-000036',
    currency: 'EGP',
    debitCents: 10000,
    creditCents: 0,
    voucher: 'V1',
    ...overrides,
  });

  /** A balanced UniqueId: ledger debit, vendor credit, petty-cash credit. */
  const expected = (): PlannedJournalLine[] => [
    planned(1, {
      accountType: 'Ledger',
      account: LEDGER,
      debitCents: 30000,
    }),
    planned(2, {
      accountType: 'Vendor',
      account: 'Sl-000036',
      debitCents: 0,
      creditCents: 20000,
    }),
    planned(3, {
      accountType: 'RCash',
      account: 'AlexHO EG',
      debitCents: 0,
      creditCents: 10000,
    }),
  ];

  /** The same journal as D365 returns it (own numbers, canonical casing). */
  const inD365 = (): ActualJournalLine[] => [
    actual(11, {
      accountType: 'Ledger',
      account: LEDGER.replace('EXPORT', 'Export'),
      debitCents: 30000,
      voucher: 'V1',
    }),
    actual(12, {
      accountType: 'Vend',
      account: 'Sl-000036',
      debitCents: 0,
      creditCents: 20000,
      voucher: 'V1',
    }),
    actual(13, {
      accountType: 'RCash',
      account: 'AlexHO EG',
      debitCents: 0,
      creditCents: 10000,
      voucher: 'V1',
    }),
  ];

  const verify = (
    plan: PlannedJournalLine[],
    lines: ActualJournalLine[],
    checkVoucherBalance = true,
  ) =>
    verifyJournalContent({
      journalNumber: 'Mesco-000019470',
      planned: plan,
      actual: lines,
      checkVoucherBalance,
    });

  const codes = (errors: ReturnType<typeof verify>) => [
    ...new Set(errors.map((e) => e.code)),
  ];

  it('accepts a journal whose lines match exactly (different line numbers and casing)', () => {
    expect(verify(expected(), inD365())).toEqual([]);
  });

  it('accepts an empty plan against an empty journal', () => {
    expect(verify([], [])).toEqual([]);
  });

  describe('missing lines', () => {
    it('reports a missing line', () => {
      const errors = verify(expected(), inD365().slice(0, 2));
      expect(codes(errors)).toContain('JOURNAL_LINES_MISSING');
      expect(errors[0].message).toContain('missing 1 planned line');
    });

    it('reports a completely empty journal', () => {
      expect(codes(verify(expected(), []))).toEqual(['JOURNAL_LINES_MISSING']);
    });
  });

  describe('extra and duplicated lines', () => {
    it('reports an extra line of an unknown UniqueId', () => {
      const errors = verify(expected(), [
        ...inD365(),
        actual(14, { paymentId: 'STRANGER' }),
      ]);
      // The extra line also sits in a voucher, which it unbalances.
      expect(codes(errors)).toEqual(
        expect.arrayContaining(['JOURNAL_LINE_MISMATCH']),
      );
      expect(
        errors.find((e) => e.code === 'JOURNAL_LINE_MISMATCH')?.message,
      ).toContain('unexpected UniqueId');
    });

    it('reports a duplicated line', () => {
      const errors = verify(expected(), [
        ...inD365(),
        actual(14, {
          accountType: 'RCash',
          account: 'AlexHO EG',
          debitCents: 0,
          creditCents: 10000,
        }),
      ]);
      expect(codes(errors)).toContain('JOURNAL_LINE_MISMATCH');
      expect(
        errors.find((e) => e.code === 'JOURNAL_LINE_MISMATCH')?.message,
      ).toContain('duplicate');
    });
  });

  describe('wrong content', () => {
    it.each([
      ['vendor account', { account: 'Sl-000099' }],
      ['currency', { currency: 'USD' }],
      ['debit amount', { debitCents: 10001 }],
      ['credit amount', { creditCents: 5 }],
    ])('reports a line with the wrong %s', (_name, overrides) => {
      const lines = [...inD365(), actual(21, { debitCents: 10000 })];
      const plan = [...expected(), planned(4)];
      const wrongLines = [...inD365(), actual(21, overrides)];
      const errors = verify(plan, wrongLines, false);
      expect(codes(errors)).toEqual(
        expect.arrayContaining([
          'JOURNAL_LINES_MISSING',
          'JOURNAL_LINE_MISMATCH',
        ]),
      );
      // sanity: the unmodified line verifies
      expect(verify(plan, lines, false)).toEqual([]);
    });

    it('reports a wrong ledger account', () => {
      const lines = inD365();
      lines[0] = { ...lines[0], account: LEDGER.replace('223404', '223405') };
      const errors = verify(expected(), lines);
      expect(codes(errors)).toEqual(
        expect.arrayContaining([
          'JOURNAL_LINES_MISSING',
          'JOURNAL_LINE_MISMATCH',
        ]),
      );
    });

    it('reports a wrong account type for the same account text', () => {
      const lines = inD365();
      lines[2] = { ...lines[2], accountType: 'Bank' };
      expect(codes(verify(expected(), lines))).toContain(
        'JOURNAL_LINES_MISSING',
      );
    });

    it('catches individually wrong lines whose count and totals still match', () => {
      // Two vendors swapped their amounts: same number of lines, same total
      // debit and credit, every line wrong.
      const plan = [
        planned(1, { account: 'Sl-1', debitCents: 0, creditCents: 7000 }),
        planned(2, { account: 'Sl-2', debitCents: 0, creditCents: 3000 }),
        planned(3, {
          accountType: 'Ledger',
          account: '223404|1201',
          debitCents: 10000,
        }),
      ];
      const lines = [
        actual(1, { account: 'Sl-1', debitCents: 0, creditCents: 3000 }),
        actual(2, { account: 'Sl-2', debitCents: 0, creditCents: 7000 }),
        actual(3, {
          accountType: 'Ledger',
          account: '223404|1201',
          debitCents: 10000,
        }),
      ];

      const errors = verify(plan, lines);

      expect(lines.length).toBe(plan.length);
      expect(codes(errors)).toEqual(
        expect.arrayContaining([
          'JOURNAL_LINES_MISSING',
          'JOURNAL_LINE_MISMATCH',
        ]),
      );
    });

    it('catches a missing debit hidden by a duplicated credit (count and totals can match)', () => {
      const plan = [
        planned(1, { account: 'Sl-1', debitCents: 5000, creditCents: 0 }),
        planned(2, { account: 'Sl-2', debitCents: 0, creditCents: 5000 }),
      ];
      const lines = [
        actual(1, { account: 'Sl-2', debitCents: 0, creditCents: 5000 }),
        actual(2, { account: 'Sl-2', debitCents: 0, creditCents: 5000 }),
      ];
      expect(codes(verify(plan, lines, false))).toEqual(
        expect.arrayContaining([
          'JOURNAL_LINES_MISSING',
          'JOURNAL_LINE_MISMATCH',
        ]),
      );
    });
  });

  describe('financial dimensions of ledger lines', () => {
    it('accepts the same dimensions in different casing and without trailing empty segments', () => {
      const lines = inD365();
      lines[0] = {
        ...lines[0],
        account: LEDGER.replace('MESCO CC ALEX', 'mesco cc alex'),
      };
      expect(verify(expected(), lines)).toEqual([]);
    });

    it('reports a different dimension value on the same main account', () => {
      const lines = inD365();
      lines[0] = { ...lines[0], account: LEDGER.replace('16517', '16518') };

      const errors = verify(expected(), lines);

      expect(codes(errors)).toEqual(['JOURNAL_LINE_MISMATCH']);
      expect(errors[0].message).toContain('financial dimensions');
    });

    it('accepts dimension values that D365 dropped (production: 223404 keeps 4 of 13)', () => {
      // Real shape from journal Mesco-000019501: the plan carries every
      // dimension, D365 stores only the first four for main account 223404.
      const lines = inD365();
      lines[0] = {
        ...lines[0],
        account: '223404|1201|012|001|001|||||||||||||||',
      };

      const result = verifyJournalContentDetailed({
        journalNumber: 'Mesco-000019501',
        planned: expected(),
        actual: lines,
        checkVoucherBalance: true,
      });

      expect(result.errors).toEqual([]);
      expect(result.droppedDimensionLines).toBe(1);
    });

    it('accepts a ledger line that kept none of the optional dimensions', () => {
      const lines = inD365();
      lines[0] = { ...lines[0], account: '223404' };
      expect(verify(expected(), lines)).toEqual([]);
    });

    it('reports a dimension value that D365 added where the plan had none', () => {
      const plan = expected();
      plan[0] = { ...plan[0], account: '223404|1201' };
      const errors = verify(plan, inD365());
      expect(codes(errors)).toEqual(['JOURNAL_LINE_MISMATCH']);
      expect(errors[0].message).toContain('changed or added');
    });

    it('pairs exact lines before dropped ones when identical lines differ only in dimensions', () => {
      const a = LEDGER.replace('16517', '16517');
      const b = LEDGER.replace('16517', '16999');
      const plan = [
        planned(1, { accountType: 'Ledger', account: a, debitCents: 500 }),
        planned(2, { accountType: 'Ledger', account: b, debitCents: 500 }),
        planned(3, { accountType: 'RCash', account: 'AlexHO EG', debitCents: 0, creditCents: 1000 }),
      ];
      const lines = [
        actual(11, { accountType: 'Ledger', account: a, debitCents: 500 }),
        actual(12, { accountType: 'Ledger', account: '223404|1201|012|001|001', debitCents: 500 }),
        actual(13, { accountType: 'RCash', account: 'AlexHO EG', debitCents: 0, creditCents: 1000 }),
      ];
      const result = verifyJournalContentDetailed({
        journalNumber: 'J',
        planned: plan,
        actual: lines,
        checkVoucherBalance: true,
      });
      expect(result.errors).toEqual([]);
      expect(result.droppedDimensionLines).toBe(1);
    });
  });

  describe('voucher balance from the D365 values', () => {
    it('reports an unbalanced voucher', () => {
      const lines = inD365();
      // Same identities, but the petty-cash line sits in another voucher.
      lines[2] = { ...lines[2], voucher: 'V2' };

      const errors = verify(expected(), lines);

      expect(codes(errors)).toEqual(['JOURNAL_IMBALANCE']);
      expect(errors[0].message).toContain('V1');
      expect(errors[0].message).toContain('V2');
    });

    it('accepts a voucher within the one-cent X++ closing tolerance', () => {
      const plan = [
        planned(1, { debitCents: 10001, account: 'Sl-1' }),
        planned(2, { debitCents: 0, creditCents: 10000, account: 'Sl-2' }),
      ];
      const lines = [
        actual(1, { debitCents: 10001, account: 'Sl-1' }),
        actual(2, { debitCents: 0, creditCents: 10000, account: 'Sl-2' }),
      ];
      expect(verify(plan, lines)).toEqual([]);
    });

    it('does not compare nominal amounts of different currencies in one voucher', () => {
      const plan = [
        planned(1, { debitCents: 487500, currency: 'EGP', account: 'Sl-1' }),
        planned(2, {
          debitCents: 0,
          creditCents: 10000,
          currency: 'USD',
          account: 'Sl-2',
        }),
      ];
      const lines = [
        actual(1, { debitCents: 487500, currency: 'EGP', account: 'Sl-1' }),
        actual(2, {
          debitCents: 0,
          creditCents: 10000,
          currency: 'USD',
          account: 'Sl-2',
        }),
      ];
      expect(verify(plan, lines)).toEqual([]);
    });

    it('skips the voucher check when the plan has lines with an offset account', () => {
      const lines = inD365();
      lines[2] = { ...lines[2], voucher: 'V2' };
      expect(verify(expected(), lines, false)).toEqual([]);
    });
  });

  describe('journals that already hold valid lines (partial retry)', () => {
    it('verifies the WHOLE journal: earlier valid lines must be there, nothing unexpected', () => {
      // The plan covers two UniqueIds; U1 was posted by an earlier attempt.
      const plan = [
        ...expected(),
        planned(4, {
          paymentId: 'U2',
          accountType: 'Ledger',
          account: '223404|1201',
          debitCents: 500,
        }),
        planned(5, {
          paymentId: 'U2',
          accountType: 'RCash',
          account: 'AlexHO EG',
          debitCents: 0,
          creditCents: 500,
        }),
      ];
      const lines = [
        ...inD365(),
        actual(14, {
          paymentId: 'U2',
          accountType: 'Ledger',
          account: '223404|1201',
          debitCents: 500,
          voucher: 'V9',
        }),
        actual(15, {
          paymentId: 'U2',
          accountType: 'RCash',
          account: 'AlexHO EG',
          debitCents: 0,
          creditCents: 500,
          voucher: 'V9',
        }),
      ];
      expect(verify(plan, lines)).toEqual([]);

      // An earlier valid line that has since vanished is reported.
      expect(codes(verify(plan, lines.slice(1)))).toContain(
        'JOURNAL_LINES_MISSING',
      );
    });

    it('does not count the same identity of another UniqueId as present', () => {
      const lines = inD365().map((l) => ({ ...l, paymentId: 'OTHER' }));
      expect(codes(verify(expected(), lines))).toEqual(
        expect.arrayContaining([
          'JOURNAL_LINES_MISSING',
          'JOURNAL_LINE_MISMATCH',
        ]),
      );
    });
  });

  describe('formatJournalIntegrityFailure', () => {
    it('lists the codes and states that no settlement marks were written', () => {
      const message = formatJournalIntegrityFailure(
        verify(expected(), inD365().slice(0, 2)),
      );
      expect(message).toContain('[JOURNAL_LINES_MISSING]');
      expect(message).toContain('Invoice settlement marks were not written.');
    });
  });
});
