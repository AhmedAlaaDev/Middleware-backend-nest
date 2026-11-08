import {
  ActualJournalLine,
  classifyTimeoutRecovery,
  countJournalIdentities,
  decimalToCents,
  journalLineIdentityKey,
  compareLedgerDimensions,
  normalizeJournalAccount,
  normalizeJournalAccountType,
  normalizeLedgerDimensions,
  PlannedJournalLine,
  reconcileExistingJournalLines,
  toActualJournalLine,
} from './cash-journal-line-identity';

const planned = (
  lineNumber: number,
  overrides: Partial<PlannedJournalLine> = {},
): PlannedJournalLine => ({
  lineNumber,
  paymentId: 'U1',
  accountType: 'Vendor',
  account: 'Sl-000036',
  currency: 'EGP',
  debitCents: 1000,
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
  debitCents: 1000,
  creditCents: 0,
  voucher: 'V1',
  ...overrides,
});

describe('cash journal line identity', () => {
  describe('decimalToCents', () => {
    it.each([
      [0.1 + 0.2, 30],
      [8093.959999999999, 809396],
      [59.489999999999995, 5949],
      [33.2889, 3329], // 4-decimal source, D365 stores 2
      [33.285, 3329], // half-cent rounds up like D365
      [1.005, 101],
      [-2.5, -250],
      [0, 0],
      [undefined, 0],
      [null, 0],
      ['12.50', 1250],
      [Number.NaN, 0],
    ])('converts %p to %p cents', (amount, cents) => {
      expect(decimalToCents(amount)).toBe(cents);
    });
  });

  describe('normalisation', () => {
    it.each([
      ['Vendor', 'vend'],
      ['Vend', 'vend'],
      ['RCash', 'rcash'],
      ['Petty cash', 'rcash'],
      ['Ledger', 'ledger'],
      ['Bank', 'bank'],
    ])('maps account type %p to %p', (type, expected) => {
      expect(normalizeJournalAccountType(type)).toBe(expected);
    });

    it('identifies a ledger line by its main account only', () => {
      expect(
        normalizeJournalAccount('Ledger', '223404|1201|012|001|001|301000002'),
      ).toBe('223404');
      expect(normalizeJournalAccount('Ledger', ' 223404 ')).toBe('223404');
    });

    it('compares vendor, bank and petty-cash accounts exactly after trimming and casing', () => {
      expect(normalizeJournalAccount('Vendor', '  SL-000036 ')).toBe(
        'sl-000036',
      );
      expect(normalizeJournalAccount('RCash', 'AlexHO  EG')).toBe('alexho eg');
    });

    it('normalises ledger dimensions case-insensitively and ignores trailing empty segments', () => {
      expect(normalizeLedgerDimensions('223404|1201|EXPORT|MESCO CC||||')).toBe(
        '223404|1201|export|mesco cc',
      );
      expect(normalizeLedgerDimensions('223404|1201|Export|Mesco CC')).toBe(
        '223404|1201|export|mesco cc',
      );
    });
  });

  describe('identity key', () => {
    it('is stable across case and whitespace', () => {
      expect(
        journalLineIdentityKey(planned(1, { account: ' sl-000036 ' })),
      ).toBe(journalLineIdentityKey(actual(9)));
    });

    it.each([
      ['UniqueId', { paymentId: 'U2' }],
      ['account type', { accountType: 'Ledger' }],
      ['account', { account: 'Sl-000037' }],
      ['currency', { currency: 'USD' }],
      ['debit amount', { debitCents: 1001 }],
      ['credit amount', { creditCents: 1 }],
    ])('differs when the %s differs', (_name, overrides) => {
      expect(journalLineIdentityKey(planned(1, overrides))).not.toBe(
        journalLineIdentityKey(planned(1)),
      );
    });

    it('does not use the line number', () => {
      expect(journalLineIdentityKey(planned(1))).toBe(
        journalLineIdentityKey(planned(999)),
      );
    });
  });

  describe('toActualJournalLine', () => {
    it('maps a VendorPaymentJournalLines row, converting amounts to cents', () => {
      expect(
        toActualJournalLine({
          LineNumber: 7,
          PaymentId: ' 558493 ',
          AccountType: 'Vend',
          AccountDisplayValue: '3063',
          CurrencyCode: 'EGP',
          DebitAmount: 0,
          CreditAmount: 1300.5,
          Voucher: 'P-Freight-000106901',
        }),
      ).toEqual({
        lineNumber: 7,
        paymentId: '558493',
        accountType: 'Vend',
        account: '3063',
        currency: 'EGP',
        debitCents: 0,
        creditCents: 130050,
        voucher: 'P-Freight-000106901',
      });
    });
  });

  describe('reconcileExistingJournalLines', () => {
    it('finds nothing when D365 holds none of the lines', () => {
      const result = reconcileExistingJournalLines(
        [planned(1), planned(2, { account: 'X' })],
        [],
      );
      expect(result.existingPlannedLineNumbers.size).toBe(0);
      expect(result.ambiguousIdentities).toEqual([]);
    });

    it('matches by content even though D365 numbers differ', () => {
      const result = reconcileExistingJournalLines(
        [planned(1), planned(2, { account: 'Sl-000037' })],
        [actual(40), actual(41, { account: 'Sl-000037' })],
      );
      expect([...result.existingPlannedLineNumbers].sort()).toEqual([1, 2]);
    });

    it('matches repeated identical lines only when the counts are equal', () => {
      const lines = [planned(1), planned(2), planned(3)];
      const equal = reconcileExistingJournalLines(lines, [
        actual(5),
        actual(6),
        actual(7),
      ]);
      expect(equal.existingPlannedLineNumbers.size).toBe(3);
      expect(equal.ambiguousIdentities).toEqual([]);
    });

    it('flags fewer identical lines than planned as ambiguous and never as existing', () => {
      const result = reconcileExistingJournalLines(
        [planned(1), planned(2), planned(3)],
        [actual(5), actual(6)],
      );
      expect(result.existingPlannedLineNumbers.size).toBe(0);
      expect(result.ambiguousIdentities).toEqual([
        expect.objectContaining({
          paymentId: 'U1',
          planned: 3,
          actual: 2,
          plannedLineNumbers: [1, 2, 3],
        }),
      ]);
    });

    it('flags more identical lines than planned (a duplicate) as ambiguous', () => {
      const result = reconcileExistingJournalLines(
        [planned(1)],
        [actual(5), actual(6)],
      );
      expect(result.existingPlannedLineNumbers.size).toBe(0);
      expect(result.ambiguousIdentities).toHaveLength(1);
    });

    it('ignores D365 lines of other UniqueIds', () => {
      const result = reconcileExistingJournalLines(
        [planned(1)],
        [actual(5, { paymentId: 'OTHER' })],
      );
      expect(result.existingPlannedLineNumbers.size).toBe(0);
      expect(result.ambiguousIdentities).toEqual([]);
    });
  });

  describe('classifyTimeoutRecovery', () => {
    const request = [planned(1), planned(2, { account: 'Sl-000037' })];

    it('is COMMITTED when every submitted line appeared since the baseline', () => {
      expect(
        classifyTimeoutRecovery(request, new Map(), [
          actual(30),
          actual(31, { account: 'Sl-000037' }),
        ]),
      ).toBe('COMMITTED');
    });

    it('is NOT_COMMITTED when nothing new appeared', () => {
      expect(classifyTimeoutRecovery(request, new Map(), [])).toBe(
        'NOT_COMMITTED',
      );
    });

    it('is AMBIGUOUS when only part of the request appeared', () => {
      expect(classifyTimeoutRecovery(request, new Map(), [actual(30)])).toBe(
        'AMBIGUOUS',
      );
    });

    it('measures against the baseline so identical earlier lines are not counted as this request', () => {
      const baseline = countJournalIdentities([actual(1)]);
      // One identical line existed before; now two: this request committed.
      expect(
        classifyTimeoutRecovery([planned(2)], baseline, [actual(1), actual(2)]),
      ).toBe('COMMITTED');
      // Still one: this request did not commit.
      expect(classifyTimeoutRecovery([planned(2)], baseline, [actual(1)])).toBe(
        'NOT_COMMITTED',
      );
    });
  });

  describe('compareLedgerDimensions (D365 drops dimensions its account structure does not allow)', () => {
    const PLAN =
      '223404|1501|015|001|001|301000002|301000002|3066|3066|16517|MESCO CC ALEX|3115|Payable|||EXPORT||||';

    it('is EXACT for the same values in canonical casing', () => {
      expect(
        compareLedgerDimensions(PLAN, PLAN.replace('EXPORT', 'Export')),
      ).toBe('EXACT');
    });

    it('is DROPPED when D365 kept only the first four dimensions (223404 in production)', () => {
      expect(
        compareLedgerDimensions(PLAN, '223404|1501|015|001|001|||||||||||||||'),
      ).toBe('DROPPED');
    });

    it('is DROPPED when D365 kept none of the optional dimensions', () => {
      expect(compareLedgerDimensions(PLAN, '223404')).toBe('DROPPED');
    });

    it('is DIFFERENT when a kept value was changed', () => {
      expect(
        compareLedgerDimensions(PLAN, PLAN.replace('16517', '16518')),
      ).toBe('DIFFERENT');
    });

    it('is DIFFERENT when D365 holds a value the plan did not have', () => {
      expect(
        compareLedgerDimensions('223404|1501|015|001|001', PLAN),
      ).toBe('DIFFERENT');
    });

    it('is DIFFERENT when the main account differs', () => {
      expect(compareLedgerDimensions(PLAN, PLAN.replace('223404', '223405'))).toBe(
        'DIFFERENT',
      );
    });
  });
});
