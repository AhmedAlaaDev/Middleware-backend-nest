import { YARD_INVOICE_LIMITS } from './yard-invoice.constants';

/**
 * Exact fixed-point money. A value is stored as an integer count of micro
 * units (10^-6). Binary floating point is never used for summation.
 */
export type Micro = bigint;

const SCALE = YARD_INVOICE_LIMITS.amountScale;
const UNITS_PER_MAJOR = 10n ** BigInt(SCALE);
const MAX_INTEGER_DIGITS = YARD_INVOICE_LIMITS.maxAmountIntegerDigits;
const MAX_ABS_MICRO = 10n ** BigInt(MAX_INTEGER_DIGITS) * UNITS_PER_MAJOR;

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

export class YardInvoiceDecimalError extends Error {}

/**
 * Parses a plain decimal string ("1350", "1350.0001", "-2.5"). Exponents,
 * thousands separators and more than six fractional digits are rejected.
 */
export function parseDecimalToMicro(input: string): Micro {
  const text = (typeof input === 'string' ? input : '').trim();
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) {
    throw new YardInvoiceDecimalError(
      `"${text}" is not a plain decimal number`,
    );
  }
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > SCALE) {
    throw new YardInvoiceDecimalError(
      `"${text}" has more than ${SCALE} decimal places`,
    );
  }
  if (whole.length > MAX_INTEGER_DIGITS) {
    throw new YardInvoiceDecimalError(`"${text}" is too large`);
  }
  const padded = fraction.padEnd(SCALE, '0');
  const magnitude = BigInt(whole) * UNITS_PER_MAJOR + BigInt(padded);
  return sign ? -magnitude : magnitude;
}

/**
 * Converts a numeric cell value to micro units without going through a
 * binary float sum. Numbers in exponent notation are rejected.
 */
export function numericValueToMicro(value: unknown): Micro {
  if (typeof value === 'bigint') {
    return parseDecimalToMicro(value.toString());
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new YardInvoiceDecimalError('amount is not a finite number');
    }
    const text = String(value);
    if (/e/i.test(text)) {
      throw new YardInvoiceDecimalError(
        'amount is in exponent notation; store it as plain text',
      );
    }
    return parseDecimalToMicro(text);
  }
  return parseDecimalToMicro(typeof value === 'string' ? value : '');
}

export function microToString(value: Micro): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / UNITS_PER_MAJOR;
  const fraction = (abs % UNITS_PER_MAJOR).toString().padStart(SCALE, '0');
  const trimmed = fraction.replace(/0+$/, '').padEnd(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${trimmed}`;
}

export function assertWithinLimit(value: Micro): void {
  if (value > MAX_ABS_MICRO || -value > MAX_ABS_MICRO) {
    throw new YardInvoiceDecimalError('amount exceeds the supported range');
  }
}

/**
 * Rounds to a currency's minor units, half away from zero. The rounding unit
 * is returned so callers can compare the rounding variance against half of
 * the smallest currency unit.
 */
export function roundMicroToCurrency(
  value: Micro,
  decimals: number,
): { rounded: Micro; unit: Micro } {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > SCALE) {
    throw new YardInvoiceDecimalError(`unsupported currency scale ${decimals}`);
  }
  const unit = 10n ** BigInt(SCALE - decimals);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const half = unit / 2n;
  const roundedAbs = ((abs + half) / unit) * unit;
  return { rounded: negative ? -roundedAbs : roundedAbs, unit };
}

export function absMicro(value: Micro): Micro {
  return value < 0n ? -value : value;
}

export const MICRO_SCALE = SCALE;
