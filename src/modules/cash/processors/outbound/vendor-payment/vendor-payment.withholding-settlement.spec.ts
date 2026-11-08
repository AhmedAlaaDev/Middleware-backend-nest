import { VendorPaymentLineBuilder } from './vendor-payment-line.builder';

import { NativeWithholdingSettings } from '@/modules/cash/policies/cash-native-withholding.policy';

/**
 * Vendor Payment native withholding (production path: VendorPaymentLineBuilder).
 * Source rows: vendor debit GROSS, payment credit NET, 223304 credit = tax.
 *   Dr vendor 2,260.62 = Cr bank 2,201.13 + Cr 223304 59.49
 * Native mode emits ONE net vendor line (Dr 2,201.13, offset the payment
 * account) flagged for native withholding; the settlement step then marks the
 * gross 2,260.62. X++ would only mark the line's own net amount (it settles
 * AmountCurDebit), which is why the gross mark cannot come from X++.
 * Anything not provably reconciled keeps the explicit 223304 companion.
 */
const SETTINGS: NativeWithholdingSettings = {
  withholdingGroup: 'WHT-3%',
  withholdingRatePercent: 3,
  vatPercent: 14,
};

function line(overrides: Record<string, unknown>): any {
  return {
    LINENUMBER: 1,
    UniqueId: 1,
    IsVendor: false,
    ACCOUNTTYPE: '',
    ACCOUNTDISPLAYVALUE: '',
    VendorGroup: 'Normal',
    DEBITAMOUNT: 0,
    CREDITAMOUNT: 0,
    DOCUMENT: 'DOC-1',
    INVOICE: '',
    MARKEDINVOICE: '',
    CURRENCYCODE: 'EGP',
    FINTAGDISPLAYVALUE: 'OP-1|',
    ...overrides,
  };
}

const vendor = (n: number, invoice: string, gross: number, extra = {}) =>
  line({
    LINENUMBER: n,
    IsVendor: true,
    ACCOUNTTYPE: 'Vend',
    ACCOUNTDISPLAYVALUE: 'Sl-000036',
    INVOICE: invoice,
    DEBITAMOUNT: gross,
    ...extra,
  });
const withholding = (n: number, invoice: string, amount: number, extra = {}) =>
  line({
    LINENUMBER: n,
    ACCOUNTTYPE: 'Ledger',
    ACCOUNTDISPLAYVALUE: '223304|dims',
    CREDITAMOUNT: amount,
    INVOICE: invoice,
    ...extra,
  });
const bank = (n: number, amount: number) =>
  line({
    LINENUMBER: n,
    ACCOUNTTYPE: 'Bank',
    ACCOUNTDISPLAYVALUE: 'BANK-1',
    CREDITAMOUNT: amount,
  });

const make = (native?: NativeWithholdingSettings) => {
  const buildVendorLine = jest.fn((...args: any[]) => ({ args }) as any);
  const builder = new VendorPaymentLineBuilder(
    buildVendorLine as any,
    () => native,
  );
  const summary = () =>
    buildVendorLine.mock.calls.map((call) => ({
      vendorDebit: call[1].DEBITAMOUNT,
      offset: call[2].ACCOUNTDISPLAYVALUE,
      offsetCredit: call[2].CREDITAMOUNT,
      source: call[3],
    }));
  return { builder, buildVendorLine, summary };
};

describe('Vendor Payment native withholding', () => {
  const real = () => [
    vendor(1, '5815410364', 2260.62),
    withholding(2, '5815410364', 59.49),
    bank(3, 2201.13),
  ];

  it('emits one net vendor line, no 223304 companion, and flags it native', () => {
    const { builder, summary } = make(SETTINGS);
    const result = builder.build('559989', real());

    expect(result).toHaveLength(1);
    expect(summary()).toEqual([
      {
        vendorDebit: 2260.62,
        offset: 'BANK-1',
        offsetCredit: 2201.13, // net payment: debit = credit on the journal line
        source: 'OFFSET',
      },
    ]);
    expect((result[0] as any).NativeWithholding).toEqual({
      withholdingGroup: 'WHT-3%',
      grossAmount: 2260.62,
      withholdingAmount: 59.49,
    });
  });

  it('keeps today’s explicit companion when the gate is closed (disabled fallback)', () => {
    const { builder, summary } = make(undefined);
    const result = builder.build('559989', real());

    expect(result).toHaveLength(2);
    expect(summary().map((s) => s.offset)).toEqual(['223304|dims', 'BANK-1']);
    expect(summary().map((s) => s.offsetCredit)).toEqual([59.49, 2201.13]);
    expect(result.some((r: any) => r.NativeWithholding)).toBe(false);
  });

  it.each([
    ['tax amount mismatch', 'amount', { withholding: 60, bank: 2200.62 }],
  ])('keeps the explicit entry on a %s and records why', (_n, _k, o: any) => {
    const { builder } = make(SETTINGS);
    const result = builder.build('x', [
      vendor(1, 'INV', 2260.62),
      withholding(2, 'INV', o.withholding),
      bank(3, o.bank),
    ]);
    expect(result).toHaveLength(2);
    expect((result[1] as any).WithholdingFallbackReason).toContain(
      'does not reconcile',
    );
    expect(result.some((r: any) => r.NativeWithholding)).toBe(false);
  });

  it('rejects an incorrect VAT assumption instead of applying the group', () => {
    const { builder } = make({ ...SETTINGS, vatPercent: 0 });
    const result = builder.build('x', real());
    expect(result).toHaveLength(2);
    expect((result[1] as any).WithholdingFallbackReason).toContain('0% VAT');
  });

  it('does not override a different source withholding group', () => {
    const { builder } = make(SETTINGS);
    const result = builder.build('x', [
      vendor(1, 'INV', 2260.62),
      withholding(2, 'INV', 59.49, { ITEMWITHHOLDINGTAXGROUPCODE: 'WHT-5%' }),
      bank(3, 2201.13),
    ]);
    expect(result).toHaveLength(2);
    expect((result[1] as any).WithholdingFallbackReason).toContain('WHT-5%');
  });

  it('never touches a payment without a withholding row', () => {
    const { builder, summary } = make(SETTINGS);
    const result = builder.build('x', [vendor(1, 'INV', 1000), bank(2, 1000)]);
    expect(result).toHaveLength(1);
    expect(summary()).toEqual([
      { vendorDebit: 1000, offset: 'BANK-1', offsetCredit: 1000, source: 'ACCOUNT' },
    ]);
    expect((result[0] as any).NativeWithholding).toBeUndefined();
  });

  it('handles several invoices of one vendor: only those with reconciling withholding go native', () => {
    const { builder, summary } = make(SETTINGS);
    const result = builder.build('multi', [
      vendor(1, 'A', 2260.62, { FINTAGDISPLAYVALUE: 'OP-A|' }),
      vendor(2, 'B', 1140, { FINTAGDISPLAYVALUE: 'OP-B|' }),
      vendor(3, 'C', 500, { FINTAGDISPLAYVALUE: 'OP-C|' }),
      withholding(4, 'A', 59.49, { FINTAGDISPLAYVALUE: 'OP-A|w' }),
      withholding(5, 'B', 30, { FINTAGDISPLAYVALUE: 'OP-B|w' }),
      bank(6, 2201.13 + 1110 + 500),
    ]);

    expect(result).toHaveLength(3);
    expect((result as any[]).map((r) => !!r.NativeWithholding)).toEqual([
      true,
      true,
      false,
    ]);
    expect(summary().map((s) => s.offsetCredit)).toEqual([2201.13, 1110, 500]);
    expect(summary().some((s) => s.offset === '223304|dims')).toBe(false);
  });

  it('sums several withholding rows of one invoice before reconciling', () => {
    const { builder } = make(SETTINGS);
    const result = builder.build('multi-wht', [
      vendor(1, 'INV', 1130.31, { FINTAGDISPLAYVALUE: 'OP-1|' }),
      vendor(2, 'INV', 1130.31, { FINTAGDISPLAYVALUE: 'OP-2|' }),
      withholding(3, 'INV', 30, { FINTAGDISPLAYVALUE: 'OP-1|w' }),
      withholding(4, 'INV', 29.49, { FINTAGDISPLAYVALUE: 'OP-2|w' }),
      bank(5, 2201.13),
    ]);
    expect(result).toHaveLength(1);
    expect((result[0] as any).NativeWithholding).toEqual({
      withholdingGroup: 'WHT-3%',
      grossAmount: 2260.62,
      withholdingAmount: 59.49,
    });
  });

  it('keeps vendors independent in one batch', () => {
    const { builder, summary } = make(SETTINGS);
    const result = builder.build('vendors', [
      vendor(1, 'A', 2260.62, { ACCOUNTDISPLAYVALUE: 'Sl-000036' }),
      vendor(2, 'B', 1140, { ACCOUNTDISPLAYVALUE: 'Sl-000001' }),
      withholding(3, 'A', 59.49),
      withholding(4, 'B', 31),
      bank(5, 2201.13 + 1109),
    ]);
    // Vendor A reconciles (native); vendor B's 31 does not (explicit companion).
    expect((result as any[]).filter((r) => r.NativeWithholding)).toHaveLength(1);
    expect(summary().filter((s) => s.offset === '223304|dims')).toHaveLength(1);
  });

  it('never applies to a custody vendor', () => {
    const { builder } = make(SETTINGS);
    const result = builder.build('custody', [
      vendor(1, 'INV', 2260.62, { VendorGroup: 'Custody' }),
      withholding(2, 'INV', 59.49),
      bank(3, 2201.13),
    ]);
    expect(result.some((r: any) => r.NativeWithholding)).toBe(false);
  });
});
