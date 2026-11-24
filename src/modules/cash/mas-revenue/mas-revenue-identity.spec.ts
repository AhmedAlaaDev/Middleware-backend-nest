import {
  MAS_REVENUE_IDENTITY_VERSION,
  MAS_REVENUE_PAYMENT_ID_MAX_LENGTH,
  MAS_REVENUE_SOURCE_NAMESPACE,
  masRevenueFingerprint,
  masRevenueGlPaymentId,
  masRevenueIdentity,
  masRevenuePaymentIdBase,
  reliableYear,
} from './mas-revenue-identity';
import {
  evaluateMasRevenueReceiptIdentities,
  type MasRevenuePriorReceipt,
} from './mas-revenue-identity-policy';

import type { MasRevenueReceipt } from './mas-revenue.types';

function receipt(
  overrides: Partial<MasRevenueReceipt> = {},
): MasRevenueReceipt {
  return {
    sourceSheet: 'Row Data',
    sourceRow: 2,
    invoiceNumber: '1',
    transactionDate: '2026-10-28',
    currency: 'EGP',
    valueMinor: 160000,
    vatMinor: 22400,
    totalMinor: 182400,
    cashAccountDisplayName: 'خزينة بور سعيد مصري',
    customerName: 'GIVAUDAN EGYPT',
    containerType: '20DC',
    containerNumber: 'SEKU1165565',
    billOfLading: 'HLCUIZ1260983630',
    revenueType: 'In',
    seaLine: 'Habag Lloyd',
    vatCardNumber: '100497772',
    ...overrides,
  };
}

describe('reliableYear', () => {
  it('returns the year of a real calendar date', () => {
    expect(reliableYear('2026-10-28')).toBe(2026);
    expect(reliableYear('2028-02-29')).toBe(2028);
  });

  it('refuses dates that are not real, not ISO or out of range', () => {
    expect(reliableYear('2026-02-30')).toBeNull();
    expect(reliableYear('2026-13-01')).toBeNull();
    expect(reliableYear('2027-02-29')).toBeNull();
    expect(reliableYear('28/10/2026')).toBeNull();
    expect(reliableYear('1999-12-31')).toBeNull();
    expect(reliableYear('')).toBeNull();
  });
});

describe('masRevenueIdentity', () => {
  it('is deterministic for the same company, namespace, year and invoice', () => {
    const a = masRevenueIdentity({
      transactionDate: '2026-10-28',
      invoiceNumber: '1',
    });
    const b = masRevenueIdentity({
      transactionDate: '2026-01-02',
      invoiceNumber: '1',
    });
    expect(a.key).toBe(b.key);
    expect(a.hash).toBe(b.hash);
    expect(a.source).toBe(MAS_REVENUE_SOURCE_NAMESPACE);
    expect(a.version).toBe(MAS_REVENUE_IDENTITY_VERSION);
  });

  it('gives a different identity for the same invoice in another year', () => {
    const y2026 = masRevenueIdentity({
      transactionDate: '2026-10-28',
      invoiceNumber: '1',
    });
    const y2027 = masRevenueIdentity({
      transactionDate: '2027-01-05',
      invoiceNumber: '1',
    });
    expect(y2027.key).not.toBe(y2026.key);
    expect(y2027.paymentIdBase).not.toBe(y2026.paymentIdBase);
  });

  it('keeps the invoice number exactly as normalized, and refuses an empty one', () => {
    const spaced = masRevenueIdentity({
      transactionDate: '2026-10-28',
      invoiceNumber: '  INV  7 ',
    });
    expect(spaced.invoiceNumber).toBe('INV 7');
    expect(() =>
      masRevenueIdentity({
        transactionDate: '2026-10-28',
        invoiceNumber: '   ',
      }),
    ).toThrow(/invoice number is required/);
  });

  it('treats invoice text as data: separators cannot make two identities equal', () => {
    const a = masRevenueIdentity({
      transactionDate: '2026-10-28',
      invoiceNumber: '1","2026',
    });
    const b = masRevenueIdentity({
      transactionDate: '2026-10-28',
      invoiceNumber: '1',
    });
    expect(a.key).not.toBe(b.key);
    expect(a.paymentIdBase).not.toBe(b.paymentIdBase);
  });

  it('refuses a date that is not reliable rather than guessing a year', () => {
    expect(() =>
      masRevenueIdentity({ transactionDate: '2026-02-30', invoiceNumber: '1' }),
    ).toThrow(/not a reliable calendar date/);
  });

  it('does not depend on anything but company, year and invoice', () => {
    const a = masRevenueIdentity({
      transactionDate: '2026-10-28',
      invoiceNumber: '1',
    });
    expect(Object.keys(a).sort()).toEqual(
      [
        'company',
        'hash',
        'invoiceNumber',
        'key',
        'paymentIdBase',
        'source',
        'version',
        'year',
      ].sort(),
    );
  });
});

describe('PaymentIds', () => {
  it('version 2 base is MR<year>-<16 hex>, within the limit with both suffixes', () => {
    const identity = masRevenueIdentity({
      transactionDate: '2026-10-28',
      invoiceNumber: '1',
    });
    expect(identity.paymentIdBase).toMatch(/^MR2026-[0-9A-F]{16}$/);
    const base = masRevenuePaymentIdBase({
      invoiceNumber: '1',
      transactionDate: '2026-10-28',
      identityVersion: 2,
    });
    expect(base).toBe(identity.paymentIdBase);
    for (const suffix of ['REV', 'VAT'] as const) {
      const id = masRevenueGlPaymentId(
        {
          invoiceNumber: '1',
          transactionDate: '2026-10-28',
          identityVersion: 2,
        },
        suffix,
      );
      expect(id).toBe(`${identity.paymentIdBase}-${suffix}`);
      expect(id.length).toBeLessThanOrEqual(MAS_REVENUE_PAYMENT_ID_MAX_LENGTH);
    }
  });

  it('a very long invoice still fits, because the id is hash based and never truncated', () => {
    const invoiceNumber = 'X'.repeat(60);
    const id = masRevenueGlPaymentId(
      { invoiceNumber, transactionDate: '2026-10-28', identityVersion: 2 },
      'VAT',
    );
    expect(id.length).toBeLessThanOrEqual(MAS_REVENUE_PAYMENT_ID_MAX_LENGTH);
    expect(id).not.toContain('X'.repeat(5));
  });

  it('legacy (version 1 or absent) keeps the exact previous identifiers', () => {
    expect(
      masRevenuePaymentIdBase({
        invoiceNumber: '1',
        transactionDate: '2026-10-28',
      }),
    ).toBe('MASREV-1');
    expect(
      masRevenueGlPaymentId(
        { invoiceNumber: '1', transactionDate: '2026-10-28' },
        'REV',
      ),
    ).toBe('MASREV-1-REV');
    expect(
      masRevenueGlPaymentId(
        {
          invoiceNumber: '1',
          transactionDate: '2026-10-28',
          identityVersion: 1,
        },
        'VAT',
      ),
    ).toBe('MASREV-1-VAT');
  });

  it('the same receipt always yields the same PaymentIds (retries)', () => {
    const first = masRevenueGlPaymentId(
      { invoiceNumber: '1', transactionDate: '2026-10-28', identityVersion: 2 },
      'REV',
    );
    const again = masRevenueGlPaymentId(
      { invoiceNumber: '1', transactionDate: '2026-10-28', identityVersion: 2 },
      'REV',
    );
    expect(again).toBe(first);
  });
});

describe('masRevenueFingerprint', () => {
  it('ignores the date and row, but changes with any economic field', () => {
    const base = masRevenueFingerprint(receipt());
    expect(
      masRevenueFingerprint(
        receipt({ transactionDate: '2027-03-01', sourceRow: 9 }),
      ),
    ).toBe(base);
    expect(masRevenueFingerprint(receipt({ valueMinor: 160001 }))).not.toBe(
      base,
    );
    expect(masRevenueFingerprint(receipt({ customerName: 'OTHER' }))).not.toBe(
      base,
    );
  });
});

describe('evaluateMasRevenueReceiptIdentities', () => {
  const prior = (
    overrides: Partial<MasRevenuePriorReceipt>,
  ): MasRevenuePriorReceipt => ({
    invoiceNumber: '1',
    year: 2026,
    fingerprint: masRevenueFingerprint(receipt()),
    identityKey: null,
    reference: 'batch b1',
    ...overrides,
  });

  it('no priors: the receipt is new', () => {
    const { conflicts, identities } = evaluateMasRevenueReceiptIdentities(
      [receipt()],
      [],
    );
    expect(conflicts).toEqual([]);
    expect(identities).toHaveLength(1);
  });

  it('same company, source, year and invoice is a duplicate, for a version 2 prior', () => {
    const key = masRevenueIdentity({
      transactionDate: '2026-10-28',
      invoiceNumber: '1',
    }).key;
    const { conflicts } = evaluateMasRevenueReceiptIdentities(
      [receipt()],
      [prior({ identityKey: key })],
    );
    expect(conflicts).toEqual([
      expect.objectContaining({ code: 'DUPLICATE_RECEIPT', year: 2026 }),
    ]);
  });

  it('same year duplicate is blocked even when the prior is legacy and the content differs', () => {
    const { conflicts } = evaluateMasRevenueReceiptIdentities(
      [receipt({ valueMinor: 1 })],
      [prior({ fingerprint: 'other' })],
    );
    expect(conflicts[0]).toMatchObject({ code: 'DUPLICATE_RECEIPT' });
  });

  it('same invoice in another year with different content is a distinct identity', () => {
    const { conflicts } = evaluateMasRevenueReceiptIdentities(
      [
        receipt({
          transactionDate: '2027-01-05',
          customerName: 'OTHER CUSTOMER',
        }),
      ],
      [prior({ year: 2026 })],
    );
    expect(conflicts).toEqual([]);
  });

  it('same invoice in another year with the same content requires correction', () => {
    const { conflicts } = evaluateMasRevenueReceiptIdentities(
      [receipt({ transactionDate: '2027-01-05' })],
      [prior({ year: 2026 })],
    );
    expect(conflicts).toEqual([
      expect.objectContaining({
        code: 'CORRECTION_REQUIRED',
        year: 2027,
        priorYear: 2026,
      }),
    ]);
  });

  it('a prior with no reliable date requires reconciliation', () => {
    const { conflicts } = evaluateMasRevenueReceiptIdentities(
      [receipt()],
      [prior({ year: null })],
    );
    expect(conflicts[0]).toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
  });

  it('a receipt with no prior of the same invoice is never blocked by another invoice', () => {
    const { conflicts } = evaluateMasRevenueReceiptIdentities(
      [receipt({ invoiceNumber: '2' })],
      [prior({ invoiceNumber: '1' })],
    );
    expect(conflicts).toEqual([]);
  });
});
