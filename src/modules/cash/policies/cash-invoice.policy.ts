import { capitalize } from '@/lib/utils';

const FINTAG_SHIPPING_LINE_INDEX = 2;

/** Returns the first FinTag segment after removing invisible characters. */
export function firstCashFinancialTag(value?: string): string {
  return String(value ?? '')
    .split('|')[0]
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim();
}

/** Replaces a cash-out shipping-line FinTag segment using a vendor lookup. */
export function replaceCashShippingLineWithVendorName(
  finTagDisplayValue: string | undefined,
  getVendorName: (vendorAccount: string) => string | undefined,
): string {
  if (!finTagDisplayValue) return finTagDisplayValue ?? '';
  const parts = finTagDisplayValue.split('|');
  if (parts.length <= FINTAG_SHIPPING_LINE_INDEX) return finTagDisplayValue;

  const shippingLineCode = parts[FINTAG_SHIPPING_LINE_INDEX].replace(
    /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    '',
  ).trim();
  if (!shippingLineCode) return finTagDisplayValue;

  const vendorOrganizationName = getVendorName(shippingLineCode);
  if (!vendorOrganizationName) return finTagDisplayValue;
  parts[FINTAG_SHIPPING_LINE_INDEX] = vendorOrganizationName;
  return parts.join('|');
}

/** Formats Cash-In invoice numbers and source-specific suffixes. */
export function formatCashInboundInvoice(invoice?: string): string {
  const trimmedInvoice = invoice?.trim();
  if (!trimmedInvoice) return '';
  const parts = trimmedInvoice.split('/');
  const numberPart = parts[0]?.trim();
  const textLower = parts[1]?.trim()?.toLowerCase() ?? '';
  const number = parseInt(numberPart, 10);
  if (isNaN(number)) return '';

  if (
    [
      '0',
      '00',
      '000',
      '0000',
      '00000',
      '000000',
      '0000000',
      '00000000',
      '000000000',
      '0000000000',
    ].includes(number.toString())
  )
    return '';

  let newTextPart: string = parts[1]?.trim();
  if (/Ù†ÙˆÙ„ÙˆÙ†/.test(textLower)) newTextPart = 'OF-FW';
  const invoicePatterns = [
    /\bimport\b.*\bstore\b|\bstore\b.*\bimport\b/,
    /\bimport\b.*\bstor\b|\bstor\b.*\bimport\b/,
    /\bdekheila\b.*\bstorage\b|\bstorage\b.*\bdekheila\b/,
  ];
  if (invoicePatterns.some((pattern) => pattern.test(textLower)))
    newTextPart = 'INVOICE';

  const suffix =
    newTextPart?.toLowerCase() === 'invoice'
      ? capitalize(newTextPart)
      : newTextPart?.toUpperCase();
  return `${number.toString().padStart(9, '0')}/${suffix}`;
}

export interface CashFreeTextInvoiceEntry {
  isPosted: boolean;
}

/**
 * Validates a Cash-In line's invoice against D365FO free text invoices.
 *
 * Not every Cash-In source row carries an invoice reference — POS and
 * petty-cash customer collections in particular are frequently uploaded
 * without an `INVOICE`/`DOCUMENT` column at all. A missing invoice is
 * therefore optional and must not block the batch. When an invoice number
 * IS present, it must still exist in D365FO and be posted.
 *
 * Returns a validation error message, or `null` when the line is valid
 * (including the "no invoice provided" case).
 */
export function validateCashInboundInvoice(
  displayInvoice: string | undefined,
  lookupEntries: (invoiceKey: string) => CashFreeTextInvoiceEntry[] | undefined,
): string | null {
  const invoiceKey = String(displayInvoice ?? '')
    .trim()
    .toLowerCase();

  if (!invoiceKey) return null;

  const entries = lookupEntries(invoiceKey);
  if (!entries?.length) {
    return `Free text invoice (${displayInvoice}) not exists in D365FO`;
  }

  const hasPostedEntry = entries.some((entry) => entry.isPosted);
  if (!hasPostedEntry) {
    return `(${displayInvoice}) exists in D365FO but is not posted (IsPosted=No)`;
  }

  return null;
}

/** Formats Cash-Out invoice numbers and source-specific suffixes. */
export function formatCashOutboundInvoice(invoice?: string): string {
  const trimmedInvoice = invoice?.trim();
  if (!trimmedInvoice) return '';
  const parts = trimmedInvoice.split('/');
  const numberPart = parts[0]?.trim();
  let textPart = parts[1]?.trim()?.toLowerCase();
  const number = parseInt(numberPart, 10);
  if (isNaN(number)) return '';

  if (textPart.includes('Ù†ÙˆÙ„ÙˆÙ†')) textPart = 'OF-FW';
  if (textPart.includes('import') && textPart.includes('store'))
    textPart = 'INVOICE';
  if (textPart.includes('dekheila') && textPart.includes('storage'))
    textPart = 'INVOICE';
  return `${number.toString().padStart(9, '0')}/${textPart.toUpperCase()}`;
}
