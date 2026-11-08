import { CustodySettlementBuilder } from './custody-settlement.builder';
import { prepareCustodySettlementLines } from './custody-settlement.processor';

import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  expectedNativeWithholdingCents,
  isNativeWithholdingGateOpen,
  NativeWithholdingSettings,
  reconcileNativeWithholding,
  resolveNativeWithholdingSettings,
} from '@/modules/cash/policies/cash-native-withholding.policy';

const SETTINGS: NativeWithholdingSettings = {
  withholdingGroup: 'WHT-3%',
  withholdingRatePercent: 3,
  vatPercent: 14,
};

/**
 * Native D365 withholding for Custody Settlement. The source files carry the
 * vendor debit GROSS, the custody credit NET and the tax as a 223304 credit:
 *   Dr vendor 2,260.62 = Cr custody 2,201.13 + Cr 223304 59.49
 * Native mode posts Dr vendor 2,201.13 / Cr custody 2,201.13 (no 223304 line),
 * enables D365's withholding calculation on the vendor line and marks the
 * invoice for the gross 2,260.62. Anything that does not reconcile exactly with
 * WHT-3% keeps the explicit 223304 entry.
 */
function line(
  overrides: Partial<CashEntryRawDataModel>,
): CashEntryRawDataModel {
  return Object.assign(Object.create(CashEntryRawDataModel.prototype), {
    UniqueId: 559989,
    LINENUMBER: 1,
    SafeType: 'Custody Settlement',
    ACCOUNTTYPE: 'Vend',
    ACCOUNTDISPLAYVALUE: 'Sl-000036',
    DEBITAMOUNT: 0,
    CREDITAMOUNT: 0,
    CURRENCYCODE: 'USD',
    DOCUMENT: '25544',
    INVOICE: '5815410364',
    FINTAGDISPLAYVALUE: 'OP-1|OTHER',
    ...overrides,
  }) as CashEntryRawDataModel;
}

/** One custody transaction: custody credit, 223304 credit, vendor debit. */
function transaction(options: {
  invoice: string;
  gross: number;
  withholding: number;
  net: number;
  currency?: string;
  firstLine?: number;
  withholdingGroup?: string;
  custodyVendor?: boolean;
}): CashEntryRawDataModel[] {
  const n = options.firstLine ?? 1;
  const currency = options.currency ?? 'USD';
  const shared = { INVOICE: options.invoice, CURRENCYCODE: currency };
  return [
    line({
      ...shared,
      LINENUMBER: n,
      ACCOUNTDISPLAYVALUE: '3210',
      CREDITAMOUNT: options.net,
    }),
    ...(options.withholding > 0
      ? [
          line({
            ...shared,
            INVOICE: '',
            LINENUMBER: n + 1,
            ACCOUNTTYPE: 'Ledger',
            ACCOUNTDISPLAYVALUE: '223304|1301|013|001|001',
            CREDITAMOUNT: options.withholding,
            ...(options.withholdingGroup
              ? { ITEMWITHHOLDINGTAXGROUPCODE: options.withholdingGroup }
              : {}),
          }),
        ]
      : []),
    line({
      ...shared,
      LINENUMBER: n + 2,
      DEBITAMOUNT: options.gross,
      ...(options.custodyVendor ? { IsCustodyVendor: true } : {}),
    }),
  ];
}

const plansFor = (lines: CashEntryRawDataModel[], native = true) =>
  prepareCustodySettlementLines(lines, {
    nativeWithholding: native ? SETTINGS : undefined,
  });

const debitOf = (lines: Array<{ line: CashEntryRawDataModel }>) =>
  lines.reduce((sum, p) => sum + Number(p.line.DEBITAMOUNT || 0), 0);
const creditOf = (lines: Array<{ line: CashEntryRawDataModel }>) =>
  lines.reduce((sum, p) => sum + Number(p.line.CREDITAMOUNT || 0), 0);

describe('withholding reconciliation (WHT-3% on the pre-VAT base)', () => {
  it.each([
    ['UniqueId 559989', 2260.62, 59.49],
    ['UniqueId 559991', 1140, 30],
    ['UniqueId 560117 (4-decimal gross)', 1580.5986, 41.59],
    ['UniqueId 489567', 23940, 630],
  ])('accepts the real source %s to the cent', (_name, gross, tax) => {
    expect(reconcileNativeWithholding(gross, tax, SETTINGS).eligible).toBe(true);
  });

  it('computes the expected tax in integer cents', () => {
    expect(expectedNativeWithholdingCents(226062, SETTINGS)).toBe(5949);
    expect(expectedNativeWithholdingCents(114000, SETTINGS)).toBe(3000);
  });

  it.each([
    ['a different amount (different rate/base/group)', 2260.62, 60],
    ['a one-cent difference (no tolerance)', 2260.62, 59.48],
    ['zero withholding', 2260.62, 0],
    ['withholding not smaller than gross', 50, 50],
    ['non-positive gross', 0, 1],
  ])('rejects %s', (_name, gross, tax) => {
    const decision = reconcileNativeWithholding(gross, tax, SETTINGS);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).not.toBe('');
  });

  describe('feature gates and settings', () => {
    const configured = {
      CASH_OUT_NATIVE_WITHHOLDING_RATE_PERCENT: '3',
      CASH_OUT_NATIVE_WITHHOLDING_VAT_PERCENT: '14',
    };

    it('is off by default for both workflows', () => {
      expect(isNativeWithholdingGateOpen('VENDOR_PAYMENT', {})).toBe(false);
      expect(isNativeWithholdingGateOpen('CUSTODY_SETTLEMENT', {})).toBe(false);
      expect(resolveNativeWithholdingSettings('VENDOR_PAYMENT', {})).toBeUndefined();
      expect(
        resolveNativeWithholdingSettings('CUSTODY_SETTLEMENT', {}),
      ).toBeUndefined();
    });

    it('keeps the original flag for Custody Settlement but never lets it enable Vendor Payment', () => {
      const legacy = { CASH_OUT_NATIVE_WITHHOLDING_VERIFIED: 'true', ...configured };
      expect(resolveNativeWithholdingSettings('CUSTODY_SETTLEMENT', legacy)).toEqual(
        { withholdingGroup: 'WHT-3%', withholdingRatePercent: 3, vatPercent: 14 },
      );
      expect(resolveNativeWithholdingSettings('VENDOR_PAYMENT', legacy)).toBeUndefined();
    });

    it('opens each workflow only through its own gate', () => {
      const vendorOnly = {
        CASH_OUT_NATIVE_WITHHOLDING_VENDOR_PAYMENT_VERIFIED: 'true',
        ...configured,
      };
      expect(resolveNativeWithholdingSettings('VENDOR_PAYMENT', vendorOnly)).toBeDefined();
      expect(
        resolveNativeWithholdingSettings('CUSTODY_SETTLEMENT', vendorOnly),
      ).toBeUndefined();
      const custodyOnly = {
        CASH_OUT_NATIVE_WITHHOLDING_CUSTODY_SETTLEMENT_VERIFIED: 'true',
        ...configured,
      };
      expect(
        resolveNativeWithholdingSettings('CUSTODY_SETTLEMENT', custodyOnly),
      ).toBeDefined();
      expect(resolveNativeWithholdingSettings('VENDOR_PAYMENT', custodyOnly)).toBeUndefined();
    });

    it.each([
      ['rate missing', { CASH_OUT_NATIVE_WITHHOLDING_VAT_PERCENT: '14' }],
      ['VAT basis missing', { CASH_OUT_NATIVE_WITHHOLDING_RATE_PERCENT: '3' }],
      [
        'rate not a number',
        {
          CASH_OUT_NATIVE_WITHHOLDING_RATE_PERCENT: 'abc',
          CASH_OUT_NATIVE_WITHHOLDING_VAT_PERCENT: '14',
        },
      ],
    ])('stays off when the %s (no hardcoded VAT)', (_name, partial) => {
      expect(
        resolveNativeWithholdingSettings('VENDOR_PAYMENT', {
          CASH_OUT_NATIVE_WITHHOLDING_VENDOR_PAYMENT_VERIFIED: 'true',
          ...partial,
        }),
      ).toBeUndefined();
    });

    it('lets the group be configured', () => {
      expect(
        resolveNativeWithholdingSettings('VENDOR_PAYMENT', {
          CASH_OUT_NATIVE_WITHHOLDING_VENDOR_PAYMENT_VERIFIED: 'true',
          CASH_OUT_NATIVE_WITHHOLDING_GROUP: 'WHT-5%',
          ...configured,
        })?.withholdingGroup,
      ).toBe('WHT-5%');
    });

    it('rejects an incorrect VAT assumption instead of applying the group', () => {
      // 59.49 reconciles at 14% VAT, not at 0% or 5% VAT.
      const at = (vatPercent: number) =>
        reconcileNativeWithholding(2260.62, 59.49, { ...SETTINGS, vatPercent });
      expect(at(14).eligible).toBe(true);
      expect(at(0).eligible).toBe(false);
      expect(at(5).eligible).toBe(false);
    });
  });
});

describe('Custody Settlement native withholding', () => {
  const real = () =>
    transaction({ invoice: '5815410364', gross: 2260.62, withholding: 59.49, net: 2201.13 });

  it('posts vendor net, drops the 223304 line and balances debit and credit', () => {
    const plans = plansFor(real());

    expect(plans).toHaveLength(2);
    expect(
      plans.some((p) => String(p.line.ACCOUNTDISPLAYVALUE).startsWith('223304')),
    ).toBe(false);
    expect(
      plans.some((p) =>
        String(p.line.OFFSETACCOUNTDISPLAYVALUE ?? '').startsWith('223304'),
      ),
    ).toBe(false);
    const vendor = plans.find((p) => p.nativeWithholding)!;
    expect(vendor.line.ACCOUNTDISPLAYVALUE).toBe('Sl-000036');
    expect(vendor.line.DEBITAMOUNT).toBe(2201.13);
    expect(vendor.nativeWithholding).toEqual({
      withholdingGroup: 'WHT-3%',
      grossAmount: 2260.62,
      withholdingAmount: 59.49,
    });
    expect(debitOf(plans)).toBe(creditOf(plans));
  });

  it('keeps today’s explicit companion when native is not enabled', () => {
    const plans = plansFor(real(), false);

    expect(plans).toHaveLength(3);
    expect(plans.some((p) => p.nativeWithholding)).toBe(false);
    const companion = plans.find((p) =>
      String(p.line.OFFSETACCOUNTDISPLAYVALUE).startsWith('223304'),
    )!;
    expect(companion.line.DEBITAMOUNT).toBe(59.49);
    expect(debitOf(plans)).toBe(2260.62);
    expect(creditOf(plans)).toBe(2201.13);
  });

  it('keeps the explicit entry and reports why when the amount does not reconcile', () => {
    const plans = plansFor(
      transaction({ invoice: 'INV', gross: 2260.62, withholding: 60, net: 2200.62 }),
    );

    expect(plans.some((p) => p.nativeWithholding)).toBe(false);
    expect(
      plans.some((p) =>
        String(p.line.OFFSETACCOUNTDISPLAYVALUE).startsWith('223304'),
      ),
    ).toBe(true);
    expect(plans.find((p) => p.withholdingFallbackReason)?.withholdingFallbackReason).toContain(
      'does not reconcile',
    );
  });

  it('does not override a different source withholding group', () => {
    const plans = plansFor(
      transaction({
        invoice: 'INV',
        gross: 2260.62,
        withholding: 59.49,
        net: 2201.13,
        withholdingGroup: 'WHT-5%',
      }),
    );
    expect(plans.some((p) => p.nativeWithholding)).toBe(false);
    expect(
      plans.find((p) => p.withholdingFallbackReason)?.withholdingFallbackReason,
    ).toContain('WHT-5%');
  });

  it('accepts a source row that already names WHT-3%', () => {
    const plans = plansFor(
      transaction({
        invoice: '82_1',
        gross: 23940,
        withholding: 630,
        net: 23310,
        currency: 'EGP',
        withholdingGroup: 'WHT-3%',
      }),
    );
    expect(plans.find((p) => p.nativeWithholding)?.line.DEBITAMOUNT).toBe(23310);
  });

  it('never applies to a transaction without a withholding row', () => {
    const lines = transaction({
      invoice: 'INV',
      gross: 1000,
      withholding: 0,
      net: 1000,
    });
    const plans = plansFor(lines);
    expect(plans).toHaveLength(2);
    expect(plans.some((p) => p.nativeWithholding)).toBe(false);
    expect(plans.find((p) => p.line.DEBITAMOUNT)?.line.DEBITAMOUNT).toBe(1000);
  });

  it('does not apply to a custody-holder vendor settled by document', () => {
    const plans = plansFor(
      transaction({
        invoice: 'INV',
        gross: 2260.62,
        withholding: 59.49,
        net: 2201.13,
        custodyVendor: true,
      }),
    );
    expect(plans.some((p) => p.nativeWithholding)).toBe(false);
  });

  it('handles several invoices with their own withholding independently', () => {
    const lines = [
      ...transaction({ invoice: 'A', gross: 2260.62, withholding: 59.49, net: 2201.13, firstLine: 1 }),
      ...transaction({ invoice: 'B', gross: 1140, withholding: 30, net: 1110, firstLine: 4 }),
      ...transaction({ invoice: 'C', gross: 500, withholding: 0, net: 500, firstLine: 7 }),
    ];
    const plans = plansFor(lines);

    const natives = plans.filter((p) => p.nativeWithholding);
    expect(natives.map((p) => p.line.INVOICE).sort()).toEqual(['A', 'B']);
    expect(natives.map((p) => p.line.DEBITAMOUNT).sort((a, b) => a - b)).toEqual([
      1110, 2201.13,
    ]);
    expect(
      plans.some((p) => String(p.line.ACCOUNTDISPLAYVALUE).startsWith('223304')),
    ).toBe(false);
    expect(debitOf(plans)).toBe(creditOf(plans));
  });

  it('keeps four-decimal source amounts exact (no cent rounding of money)', () => {
    const plans = plansFor(
      transaction({
        invoice: '5815412371',
        gross: 1580.5986,
        withholding: 41.59,
        net: 1539.0086,
      }),
    );
    const vendor = plans.find((p) => p.nativeWithholding)!;
    expect(vendor.line.DEBITAMOUNT).toBe(1539.0086);
    expect(vendor.nativeWithholding?.grossAmount).toBe(1580.5986);
  });
});

describe('Custody Settlement native withholding in the output line', () => {
  const build = (native: boolean, lines: CashEntryRawDataModel[]) =>
    new CustodySettlementBuilder(
      (_sourceId, sourceLine) =>
        new CashEntryDynDataModel({} as any, {
          AccountDisplayValue: sourceLine.ACCOUNTDISPLAYVALUE,
          OffsetAccountDisplayValue: sourceLine.OFFSETACCOUNTDISPLAYVALUE,
          DebitAmount: sourceLine.DEBITAMOUNT,
          CreditAmount: sourceLine.CREDITAMOUNT,
        } as any),
      () => (native ? SETTINGS : undefined),
    ).build('src', lines);

  it('carries the native metadata and leaves the explicit-mode fields empty', () => {
    const built = build(true, [
      ...transaction({ invoice: '5815410364', gross: 2260.62, withholding: 59.49, net: 2201.13 }),
    ]);
    expect(built).toHaveLength(2);
    const vendor = built.find((l) => l.NativeWithholding)!;
    expect(vendor.NativeWithholding).toEqual({
      withholdingGroup: 'WHT-3%',
      grossAmount: 2260.62,
      withholdingAmount: 59.49,
    });
    expect(vendor.DebitAmount).toBe(2201.13);
    // The group is written by the posting strategy (X++ puts it in
    // TaxWithholdGroup); the builder leaves the explicit-mode fields empty.
    expect(vendor.ItemWithholdingTaxGroupCode).toBe('');
    expect(vendor.IsWithholdingCalculationEnabled).toBe('No');
  });

  it('is unchanged when native mode is off', () => {
    const built = build(false, [
      ...transaction({ invoice: '5815410364', gross: 2260.62, withholding: 59.49, net: 2201.13 }),
    ]);
    expect(built).toHaveLength(3);
    expect(built.some((l) => l.NativeWithholding)).toBe(false);
  });
});
