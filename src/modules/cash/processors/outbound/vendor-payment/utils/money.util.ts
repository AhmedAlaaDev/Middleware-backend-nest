import { VendorPaymentAmounts } from '../models/vendor-invoice-match-result';

/**
 * Currency precision map (ISO 4217 standard minor units).
 * Default is 2 decimal places.
 */
const CURRENCY_DECIMALS: Record<string, number> = {
  BHD: 3,
  KWD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
  JPY: 0,
  KRW: 0,
  CLP: 0,
  VND: 0,
  EGP: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
  SAR: 2,
};

export function getCurrencyDecimals(currencyCode?: string): number {
  if (!currencyCode) return 2;
  const normalized = currencyCode.trim().toUpperCase();
  return CURRENCY_DECIMALS[normalized] ?? 2;
}

export function toMinorUnits(amount: number, currencyCode?: string): number {
  const decimals = getCurrencyDecimals(currencyCode);
  const factor = Math.pow(10, decimals);
  return Math.round(Number(amount ?? 0) * factor);
}

export function moneyRound(amount: number, currencyCode?: string): number {
  const decimals = getCurrencyDecimals(currencyCode);
  const factor = Math.pow(10, decimals);
  return Math.round(Number(amount ?? 0) * factor) / factor;
}

export function moneyEquals(
  a: number,
  b: number,
  currencyCode?: string,
): boolean {
  return toMinorUnits(a, currencyCode) === toMinorUnits(b, currencyCode);
}

export function moneyLessThanOrEqual(
  a: number,
  b: number,
  currencyCode?: string,
): boolean {
  return toMinorUnits(a, currencyCode) <= toMinorUnits(b, currencyCode);
}

export function calculateVendorPaymentAmounts(options: {
  netPaymentAmount: number;
  withholdingAmount: number;
  grossInvoiceAmount?: number;
  currencyCode?: string;
}): VendorPaymentAmounts {
  const {
    netPaymentAmount,
    withholdingAmount,
    grossInvoiceAmount,
    currencyCode,
  } = options;

  const net = moneyRound(netPaymentAmount, currencyCode);
  const wht = moneyRound(withholdingAmount, currencyCode);
  const settlement = moneyRound(net + wht, currencyCode);
  const gross =
    grossInvoiceAmount !== undefined
      ? moneyRound(grossInvoiceAmount, currencyCode)
      : settlement;

  return {
    netPaymentAmount: net,
    withholdingAmount: wht,
    settlementAmount: settlement,
    grossInvoiceAmount: gross,
  };
}
