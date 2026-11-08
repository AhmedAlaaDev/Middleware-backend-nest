/**
 * Native D365 withholding for Cash-Out Vendor Payment / Custody Settlement.
 *
 * Instead of posting the withholding as its own `223304` line, the vendor line
 * is posted at the NET amount with D365's withholding calculation switched on
 * (line-level item group, candidate WHT-3%) and the invoice is marked for the
 * GROSS amount. This is only safe when D365 will calculate the same tax the
 * source file carries, so it is decided per transaction and only after the
 * source withholding reconciles exactly with the configured model. Otherwise
 * the explicit `223304` entry is kept, so a tax liability can never be dropped
 * silently.
 *
 * Nothing here is a universal business rule: the group, the withholding rate
 * and the VAT embedded in the gross amount are configuration. If any of them
 * is missing the feature stays off.
 */

export type NativeWithholdingWorkflow = 'VENDOR_PAYMENT' | 'CUSTODY_SETTLEMENT';

/** Default candidate line-level item group (not proof of every rate). */
export const NATIVE_WITHHOLDING_GROUP = 'WHT-3%';

export interface NativeWithholdingSettings {
  /** Line-level item withholding group enabled on the vendor line. */
  withholdingGroup: string;
  /** Withholding rate applied to the pre-VAT base, in percent. */
  withholdingRatePercent: number;
  /** VAT embedded in the gross invoice amount, in percent. */
  vatPercent: number;
}

export interface NativeWithholdingDecision {
  eligible: boolean;
  grossCents: number;
  withholdingCents: number;
  expectedCents: number;
  /** Why the explicit 223304 entry is kept; empty when eligible. */
  reason: string;
}

type Env = Record<string, string | undefined>;

const isTrue = (value: string | undefined): boolean =>
  String(value ?? '')
    .trim()
    .toLowerCase() === 'true';

/**
 * Whole minor units (cents). Excel amounts carry up to four decimals while
 * D365 stores two, so both sides are compared after rounding to cents.
 */
export function toMinorUnits(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.sign(parsed) * Math.round(Math.abs(parsed) * 100 + 1e-9);
}

/** Percent to whole basis points, so the maths stays in integers. */
const toBasisPoints = (percent: number): number =>
  Math.round(percent * 100 + 1e-9);

/**
 * Withholding D365 is expected to calculate for a gross invoice amount:
 * rate% of the pre-VAT base, where base = gross / (1 + vat%). Integer maths
 * on cents, rounded half up, so no floating-point artefact decides a tax.
 */
export function expectedNativeWithholdingCents(
  grossCents: number,
  settings: NativeWithholdingSettings,
): number {
  return Math.round(
    (grossCents * toBasisPoints(settings.withholdingRatePercent)) /
      (10000 + toBasisPoints(settings.vatPercent)),
  );
}

/**
 * Whether the source withholding row reconciles exactly (to the cent) with
 * what the configured group would calculate on the gross vendor amount. There
 * is no tolerance: a different amount means a different rate, base or group.
 */
export function reconcileNativeWithholding(
  grossAmount: number,
  withholdingAmount: number,
  settings: NativeWithholdingSettings,
): NativeWithholdingDecision {
  const grossCents = toMinorUnits(grossAmount);
  const withholdingCents = toMinorUnits(withholdingAmount);
  const expectedCents =
    grossCents > 0 ? expectedNativeWithholdingCents(grossCents, settings) : 0;
  const decision = (eligible: boolean, reason: string) => ({
    eligible,
    grossCents,
    withholdingCents,
    expectedCents,
    reason,
  });

  if (grossCents <= 0) {
    return decision(false, 'gross vendor amount is not positive');
  }
  if (withholdingCents <= 0) {
    return decision(false, 'no withholding amount to account for');
  }
  if (withholdingCents >= grossCents) {
    return decision(false, 'withholding is not smaller than the gross amount');
  }
  if (withholdingCents !== expectedCents) {
    return decision(
      false,
      `source withholding ${withholdingCents / 100} does not reconcile with ${settings.withholdingGroup} (${settings.withholdingRatePercent}% on a base excluding ${settings.vatPercent}% VAT) on gross ${grossCents / 100} (expected ${expectedCents / 100})`,
    );
  }
  return decision(true, '');
}

/**
 * Each workflow has its own gate because their posting and marking paths
 * differ and one passing its tests says nothing about the other.
 * - VENDOR_PAYMENT: CASH_OUT_NATIVE_WITHHOLDING_VENDOR_PAYMENT_VERIFIED
 * - CUSTODY_SETTLEMENT: CASH_OUT_NATIVE_WITHHOLDING_CUSTODY_SETTLEMENT_VERIFIED,
 *   or the original CASH_OUT_NATIVE_WITHHOLDING_VERIFIED (kept for
 *   compatibility; it never enables Vendor Payment).
 */
export function isNativeWithholdingGateOpen(
  workflow: NativeWithholdingWorkflow,
  env: Env = process.env,
): boolean {
  if (workflow === 'VENDOR_PAYMENT') {
    return isTrue(env.CASH_OUT_NATIVE_WITHHOLDING_VENDOR_PAYMENT_VERIFIED);
  }
  return (
    isTrue(env.CASH_OUT_NATIVE_WITHHOLDING_CUSTODY_SETTLEMENT_VERIFIED) ||
    isTrue(env.CASH_OUT_NATIVE_WITHHOLDING_VERIFIED)
  );
}

/**
 * Settings for a workflow, or undefined when native withholding must stay off:
 * the gate is closed, or the withholding rate / VAT basis is not configured.
 * The explicit 223304 entry is then always kept.
 */
export function resolveNativeWithholdingSettings(
  workflow: NativeWithholdingWorkflow,
  env: Env = process.env,
): NativeWithholdingSettings | undefined {
  if (!isNativeWithholdingGateOpen(workflow, env)) return undefined;
  const rate = Number(env.CASH_OUT_NATIVE_WITHHOLDING_RATE_PERCENT);
  const vat = Number(env.CASH_OUT_NATIVE_WITHHOLDING_VAT_PERCENT);
  const hasRate =
    String(env.CASH_OUT_NATIVE_WITHHOLDING_RATE_PERCENT ?? '').trim() !== '' &&
    Number.isFinite(rate) &&
    rate > 0 &&
    rate < 100;
  const hasVat =
    String(env.CASH_OUT_NATIVE_WITHHOLDING_VAT_PERCENT ?? '').trim() !== '' &&
    Number.isFinite(vat) &&
    vat >= 0 &&
    vat < 100;
  if (!hasRate || !hasVat) return undefined;
  const withholdingGroup =
    String(env.CASH_OUT_NATIVE_WITHHOLDING_GROUP ?? '').trim() ||
    NATIVE_WITHHOLDING_GROUP;
  return { withholdingGroup, withholdingRatePercent: rate, vatPercent: vat };
}
