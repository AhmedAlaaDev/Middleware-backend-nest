import {
  verifyMasRevenueReadback,
  type MasRevenueGlLineRow,
  type MasRevenuePlannedGlLine,
} from './mas-revenue-readback';

const planned: MasRevenuePlannedGlLine = {
  account: 'FIXTURE-PETTY-PORTSAID',
  currency: 'EGP',
  debitCents: 182400,
  creditCents: 0,
  offsetAccount: '415701|2401|024|002|005',
};

const matching: MasRevenueGlLineRow = {
  LineNumber: 7,
  AccountDisplayValue: 'FIXTURE-PETTY-PORTSAID',
  CurrencyCode: 'EGP',
  DebitAmount: 1824,
  CreditAmount: 0,
  OffsetAccountDisplayValue: '415701|2401|024|002|005',
};

describe('verifyMasRevenueReadback', () => {
  it('accepts a journal whose content matches the plan, whatever the line numbers', () => {
    expect(
      verifyMasRevenueReadback([planned], [{ ...matching, LineNumber: 99 }]),
    ).toEqual([]);
  });

  it('reports a missing line', () => {
    const problems = verifyMasRevenueReadback([planned], []);
    expect(problems.join('\n')).toMatch(
      /expected 1 line\(s\) in the journal, found 0/,
    );
    expect(problems.join('\n')).toMatch(/missing line/);
  });

  it('reports an offset account that differs from the plan', () => {
    const problems = verifyMasRevenueReadback(
      [planned],
      [{ ...matching, OffsetAccountDisplayValue: '415701|2401|024|002|006' }],
    );
    expect(problems.join('\n')).toMatch(/missing line/);
    expect(problems.join('\n')).toMatch(/unexpected line/);
  });

  it('reports an amount that differs from the plan', () => {
    const problems = verifyMasRevenueReadback(
      [planned],
      [{ ...matching, DebitAmount: 1800 }],
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('reports an extra line that was not planned', () => {
    const problems = verifyMasRevenueReadback([planned], [matching, matching]);
    expect(problems.join('\n')).toMatch(
      /expected 1 line\(s\) in the journal, found 2/,
    );
    expect(problems.join('\n')).toMatch(/unexpected line/);
  });

  it('compares duplicate receipts as a multiset, so one missing copy is caught', () => {
    const problems = verifyMasRevenueReadback([planned, planned], [matching]);
    expect(problems.join('\n')).toMatch(/missing line/);
  });
});

describe('readback against the verified D365 shape', () => {
  it('reads the amounts from DebitAmount and CreditAmount, as the MAS sandbox entity returns them', () => {
    const row = {
      LineNumber: 1,
      AccountType: 'RCash',
      AccountDisplayValue: 'FIXTURE-PETTY-PORTSAID',
      CurrencyCode: 'EGP',
      DebitAmount: 1824,
      CreditAmount: 0,
      OffsetAccountType: 'Ledger',
      OffsetAccountDisplayValue: '415701|2401|024|002|005',
    };
    expect(verifyMasRevenueReadback([planned], [row])).toEqual([]);
  });

  it('treats the trailing empty segments D365 returns as the same account', () => {
    const row = {
      AccountDisplayValue: 'FIXTURE-PETTY-PORTSAID',
      CurrencyCode: 'EGP',
      DebitAmount: 1824,
      CreditAmount: 0,
      OffsetAccountDisplayValue: '415701|2401|024|002|005|||||||||||||||',
    };
    expect(verifyMasRevenueReadback([planned], [row])).toEqual([]);
  });

  it('still reports a difference in a dimension segment of the offset', () => {
    const row = {
      AccountDisplayValue: 'FIXTURE-PETTY-PORTSAID',
      CurrencyCode: 'EGP',
      DebitAmount: 1824,
      CreditAmount: 0,
      OffsetAccountDisplayValue: '415701|2401|024|002|006|||',
    };
    expect(verifyMasRevenueReadback([planned], [row]).join('\n')).toMatch(
      /missing line/,
    );
  });
});
