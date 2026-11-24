import {
  normalizeMasRevenueRows,
  parseMinor,
  toIsoDate,
} from './mas-revenue-normalizer';
import {
  MAS_REVENUE_HEADERS,
  type MasRevenueHeaderField,
} from './mas-revenue.constants';
import {
  MasRevenueCellValue,
  MasRevenueRawRow,
  MasRevenueWorkbookParseResult,
} from './mas-revenue.types';

const ALL_FIELDS = Object.keys(MAS_REVENUE_HEADERS) as MasRevenueHeaderField[];

function emptyValues(): Record<MasRevenueHeaderField, MasRevenueCellValue> {
  const values = {} as Record<MasRevenueHeaderField, MasRevenueCellValue>;
  for (const field of ALL_FIELDS) values[field] = null;
  return values;
}

function row(
  sourceRow: number,
  overrides: Partial<Record<MasRevenueHeaderField, MasRevenueCellValue>> = {},
  formulaFields: MasRevenueHeaderField[] = [],
): MasRevenueRawRow {
  const values = emptyValues();
  Object.assign(values, {
    transactionDate: 46323,
    invoiceNumber: String(sourceRow),
    value: 1600,
    vat: 224.00000000000003,
    total: 1824,
    containerType: '20DC',
    customerName: 'GIVAUDAN EGYPT',
    vatCardNumber: '100497772',
    containerNumber: 'SEKU1165565',
    billOfLading: 'HLCUIZ1260983630',
    revenueType: 'In',
    seaLine: 'Habag Lloyd',
    cashAccountName: 'خزينة بور سعيد مصري',
    ...overrides,
  });
  return {
    sourceSheet: 'Row Data',
    sourceRow,
    classification: 'transaction',
    values,
    formulaFields,
  };
}

function parsed(rows: MasRevenueRawRow[]): MasRevenueWorkbookParseResult {
  return {
    sourceSheet: 'Row Data',
    headerRow: 1,
    columnByField: {},
    scannedRowCount: rows.length + 1,
    rows,
  };
}

describe('normalizeMasRevenueRows', () => {
  it('accepts a valid receipt, treating VAT float noise as 224.00', () => {
    const result = normalizeMasRevenueRows(parsed([row(2)]));

    expect(result.issues).toEqual([]);
    expect(result.receipts).toHaveLength(1);
    const receipt = result.receipts[0];
    expect(receipt.valueMinor).toBe(160000);
    expect(receipt.vatMinor).toBe(22400);
    expect(receipt.totalMinor).toBe(182400);
    expect(receipt.transactionDate).toBe('2026-10-28');
    expect(receipt.currency).toBe(''); // resolved later from the D365 cash account
    expect(receipt.cashAccountDisplayName).toBe('خزينة بور سعيد مصري');
    expect(receipt.sourceRow).toBe(2);
  });

  it('rejects a total that does not equal value plus VAT', () => {
    const result = normalizeMasRevenueRows(parsed([row(2, { total: 1800 })]));

    expect(result.receipts).toHaveLength(0);
    expect(result.accounting).toEqual({
      transactionRowsRead: 1,
      accepted: 0,
      rejected: 1,
    });
    expect(result.issues[0].message).toMatch(/total must equal value \+ VAT/);
  });

  it('blocks every occurrence of a duplicate invoice number', () => {
    const result = normalizeMasRevenueRows(
      parsed([row(2, { invoiceNumber: '9' }), row(3, { invoiceNumber: '9' })]),
    );

    expect(result.receipts).toHaveLength(0);
    expect(result.accounting.rejected).toBe(2);
    expect(result.issues.map((i) => i.sourceRow)).toEqual([2, 3]);
    expect(result.issues[0].message).toMatch(/duplicate invoice number/);
  });

  it('rejects a row that populates the credit column', () => {
    const result = normalizeMasRevenueRows(
      parsed([row(2, { creditColumn: 'something' })]),
    );

    expect(result.receipts).toHaveLength(0);
    expect(result.issues[0].message).toMatch(/credit column must be empty/);
  });

  it('rejects zero and negative receipts instead of dropping them', () => {
    const result = normalizeMasRevenueRows(
      parsed([
        row(2, { value: 0, vat: 0, total: 0 }),
        row(3, { value: -10, vat: 0, total: -10 }),
      ]),
    );

    expect(result.receipts).toHaveLength(0);
    expect(result.accounting.rejected).toBe(2);
    expect(
      result.issues.some((i) => /zero or negative receipts/.test(i.message)),
    ).toBe(true);
  });

  it('rejects a formula in a critical cell', () => {
    const result = normalizeMasRevenueRows(parsed([row(2, {}, ['total'])]));

    expect(result.receipts).toHaveLength(0);
    expect(result.issues[0].message).toMatch(/critical cell is a formula/);
  });

  it('counts non-transaction rows and keeps every transaction row accounted for', () => {
    const blank: MasRevenueRawRow = { ...row(4), classification: 'blank' };
    const placeholder: MasRevenueRawRow = {
      ...row(5),
      classification: 'zero-placeholder',
    };
    const cancelled: MasRevenueRawRow = {
      ...row(6),
      classification: 'cancelled',
    };
    const result = normalizeMasRevenueRows(
      parsed([
        row(2),
        row(3, { invoiceNumber: '3', total: 1 }),
        blank,
        placeholder,
        cancelled,
      ]),
    );

    expect(result.nonTransactionRows).toEqual({
      blank: 1,
      zeroPlaceholder: 1,
      cancelled: 1,
    });
    expect(result.accounting).toEqual({
      transactionRowsRead: 2,
      accepted: 1,
      rejected: 1,
    });
    expect(result.receipts.length + result.accounting.rejected).toBe(
      result.accounting.transactionRowsRead,
    );
  });

  it('requires a customer name and a cash account', () => {
    const result = normalizeMasRevenueRows(
      parsed([row(2, { customerName: null, cashAccountName: null })]),
    );

    expect(result.receipts).toHaveLength(0);
    const messages = result.issues.map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'customer name (Description column) is required',
        'cash account (debit column) is required',
      ]),
    );
  });
});

describe('parseMinor', () => {
  it.each([
    [1824, 182400],
    ['1824.5', 182450],
    ['0.01', 1],
    [224.00000000000003, 22400],
  ])('parses %p to %p minor units', (input, expected) => {
    expect(parseMinor(input)).toEqual({ ok: true, minor: expected });
  });

  it.each([
    ['12.345', 'more than two decimal places'],
    [1.005, 'more than two decimal places'],
    ['1,600', 'not a plain decimal'],
    ['abc', 'not a plain decimal'],
    [Number.NaN, 'not a finite number'],
  ])('rejects %p', (input, fragment) => {
    const result = parseMinor(input as MasRevenueCellValue);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(fragment);
  });
});

describe('toIsoDate', () => {
  it('converts an Excel serial using the 1900 system', () => {
    expect(toIsoDate(46323)).toEqual({ ok: true, iso: '2026-10-28' });
    expect(toIsoDate(46324)).toEqual({ ok: true, iso: '2026-10-29' });
  });

  it('accepts a YYYY-MM-DD string and rejects an impossible date', () => {
    expect(toIsoDate('2026-02-28')).toEqual({ ok: true, iso: '2026-02-28' });
    expect(toIsoDate('2026-02-30').ok).toBe(false);
  });

  it('rejects a fractional serial rather than truncating the time', () => {
    expect(toIsoDate(46323.5).ok).toBe(false);
  });

  it('rejects a missing date', () => {
    expect(toIsoDate(null).ok).toBe(false);
  });
});
