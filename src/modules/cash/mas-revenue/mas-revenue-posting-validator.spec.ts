import {
  validateMasRevenueJournalGroups,
  type MasRevenueExpectedTaxGroups,
  type MasRevenuePostingGroupLike,
} from './mas-revenue-posting-validator';

/** The tax groups the configuration declares. Test values only. */
const EXPECTED_TAX: MasRevenueExpectedTaxGroups = {
  salesTaxGroup: '',
  itemSalesTaxGroup: 'NONTAXABLE',
};

/** A valid MAS group. The offset carries its dimensions, so its default-dimension string is empty. */
function validGroup(
  overrides: Record<string, unknown> = {},
  lineOverrides: Record<string, unknown> = {},
): MasRevenuePostingGroupLike {
  return {
    header: {
      dataAreaId: 'mas',
      JournalName: 'GL Journal',
      Description: 'MAS Revenue Cash In UPLOAD-1',
      ...overrides,
    },
    lines: [
      {
        dataAreaId: 'mas',
        LineNumber: 1,
        cashDirection: 'in',
        customLineApiBody: {
          AccountNum: 'Port Said',
          accountTypeStr: 'RCash',
          company: 'mas',
          currency: 'EGP',
          transDate: '2026-10-28',
          DEFAULTDIMENSIONDISPLAYVALUE: '2401|024|002|005',
          offsetAccountDisplayValue: '415701|2401|024|002|005',
          offsetDEFAULTDIMENSIONDISPLAYVALUE: '',
          OffsetAccountTypeStr: 'Ledger',
          OffsetCompany: 'mas',
          TaxGroup: '',
          TAXITEMGROUP: 'NONTAXABLE',
          PAYMENTREFERENCE: '',
          PAYMENTID: 'MR2026-0123456789ABCDEF-REV',
          ...lineOverrides,
        },
      },
    ],
  };
}

function check(
  groups: MasRevenuePostingGroupLike[],
  expected: MasRevenueExpectedTaxGroups = EXPECTED_TAX,
): string[] {
  return validateMasRevenueJournalGroups(groups, expected);
}

describe('validateMasRevenueJournalGroups', () => {
  it('requires a PAYMENTID and refuses one longer than the limit, without truncating it', () => {
    expect(check([validGroup({}, { PAYMENTID: '' })])).toEqual([
      'journal 1, line 1: PAYMENTID is required',
    ]);
    const tooLong = 'X'.repeat(31);
    expect(check([validGroup({}, { PAYMENTID: tooLong })])).toEqual([
      'journal 1, line 1: PAYMENTID exceeds 30 characters (31); it is not truncated',
    ]);
  });

  it('accepts a valid group whose offset account carries its dimensions, with no default-dimension string', () => {
    expect(check([validGroup()])).toEqual([]);
  });

  it('requires an offset default dimension when the offset account is a bare main account', () => {
    const errors = check([
      validGroup(
        {},
        {
          offsetAccountDisplayValue: '415101',
          offsetDEFAULTDIMENSIONDISPLAYVALUE: '',
        },
      ),
    ]);
    expect(errors.join(' ')).toMatch(
      /offset account 415101 has no dimensions and no default dimension/,
    );
  });

  it('accepts a bare main account when its default dimension is supplied', () => {
    expect(
      check([
        validGroup(
          {},
          {
            offsetAccountDisplayValue: '415101',
            offsetDEFAULTDIMENSIONDISPLAYVALUE: '2401|024|002|005',
          },
        ),
      ]),
    ).toEqual([]);
  });

  it('keeps the cash default dimension required, because a cash ID carries no dimensions', () => {
    const errors = check([
      validGroup({}, { DEFAULTDIMENSIONDISPLAYVALUE: '' }),
    ]);
    expect(errors.join(' ')).toMatch(/cash default dimension is required/);
  });

  it('rejects a non-MAS company, a non-RCash account type and a non-Ledger offset', () => {
    const errors = check([
      validGroup(
        { dataAreaId: 'm-p' },
        {
          company: 'm-p',
          accountTypeStr: 'Bank',
          OffsetAccountTypeStr: 'Cust',
        },
      ),
    ]);
    const text = errors.join(' ');
    expect(text).toMatch(/header company must be "mas"/);
    expect(text).toMatch(/company must be "mas"/);
    expect(text).toMatch(/accountTypeStr must be "RCash"/);
    expect(text).toMatch(/OffsetAccountTypeStr must be "Ledger"/);
  });

  it('requires each line to carry the configured sales-tax and item sales-tax groups exactly', () => {
    const errors = check([
      validGroup({}, { TaxGroup: 'Non-Taxabl', TAXITEMGROUP: '' }),
    ]);
    const text = errors.join(' ');
    expect(text).toMatch(/TaxGroup must be ""/);
    expect(text).toMatch(/TAXITEMGROUP must be "NONTAXABLE"/);
  });

  it('does not accept a tax group merely because its text is a known name elsewhere', () => {
    const errors = check(
      [validGroup({}, { TaxGroup: 'NONTAXABLE', TAXITEMGROUP: 'NONTAXABLE' })],
      { salesTaxGroup: 'TAX', itemSalesTaxGroup: 'NONTAXABLE' },
    );
    expect(errors.join(' ')).toMatch(/TaxGroup must be "TAX"/);
  });

  it('requires the journal name and the line currency', () => {
    const errors = check([validGroup({ JournalName: '' }, { currency: '' })]);
    const text = errors.join(' ');
    expect(text).toMatch(/header JournalName is required/);
    expect(text).toMatch(/currency is required/);
  });

  it('does not add or alter any value: it validates only what it is given', () => {
    const group = validGroup({}, { offsetDEFAULTDIMENSIONDISPLAYVALUE: '' });
    const before = JSON.stringify(group);
    check([group]);
    expect(JSON.stringify(group)).toBe(before);
  });
});
