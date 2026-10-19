const INVISIBLE_DIRECTIONAL_MARKS =
  /[\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const TRAILING_YEAR = /\s+-\s+((?:19|20)\d{2})$/;
const TRAILING_DUPLICATE_SEQUENCE = /_(\d+)$/;
const TRAILING_HYPHEN_DUPLICATE_SEQUENCE = /-(\d+)$/;

/** Removes hidden Excel/RTL marks while preserving the business value. */
export function normalizeVendorLookupText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE_DIRECTIONAL_MARKS, '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Document numbers copied from Excel can carry a trailing `.0`, leading zeros,
 * or invisible marks. Numeric documents stay equal after those differences are
 * removed. Non-numeric documents keep their significant characters.
 */
export function normalizeVendorDocumentNumber(value: unknown): string {
  let text = normalizeVendorLookupText(value).replace(/\.0+$/, '').toLowerCase();
  if (/^\d+$/.test(text)) {
    text = text.replace(/^0+(?=\d)/, '');
  }
  return text;
}

export function normalizeVendorInvoiceIdentity(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE_DIRECTIONAL_MARKS, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Finance may append a posting year (`178 - 2026`) or duplicate sequence
 * (`188_1`) while the source payment contains the base invoice. Treat those
 * as the same identity only when exactly one side has the same suffix type.
 * Two different explicit suffixes remain different invoices.
 */
export function vendorInvoiceIdentityEquals(
  left: unknown,
  right: unknown,
): boolean {
  const normalizedLeft = normalizeVendorInvoiceIdentity(left);
  const normalizedRight = normalizeVendorInvoiceIdentity(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  for (const suffix of [
    TRAILING_YEAR,
    TRAILING_DUPLICATE_SEQUENCE,
    TRAILING_HYPHEN_DUPLICATE_SEQUENCE,
  ]) {
    const leftSuffix = normalizedLeft.match(suffix);
    const rightSuffix = normalizedRight.match(suffix);
    if (Boolean(leftSuffix) === Boolean(rightSuffix)) continue;

    const leftBase = normalizedLeft.replace(suffix, '').trim();
    const rightBase = normalizedRight.replace(suffix, '').trim();
    if (leftBase && leftBase === rightBase) return true;
  }

  return false;
}
