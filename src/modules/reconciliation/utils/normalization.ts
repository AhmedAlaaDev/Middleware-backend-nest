const USELESS_WORDS = new Set([
  'company',
  'co',
  'ltd',
  'limited',
  'llc',
  'inc',
  'corp',
  'corporation',
  'egp',
  'usd',
  'eur',
  'the',
  'and',
  'for',
  'from',
  'to',
  'of',
  'شركة',
  'شركه',
]);

const BIDI_AND_ZERO_WIDTH =
  /[\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const ARABIC_DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const rich = value as {
      richText?: Array<{ text?: string }>;
      text?: string;
      result?: unknown;
    };
    if (Array.isArray(rich.richText))
      return rich.richText.map((part) => part.text ?? '').join('');
    if (rich.text !== undefined) return String(rich.text);
    if (rich.result !== undefined) return cellText(rich.result);
  }
  return String(value);
}

export function normalizeText(value: unknown): string {
  return cellText(value)
    .normalize('NFKC')
    .replace(BIDI_AND_ZERO_WIDTH, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function compactText(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, '');
}

export function normalizeReference(value: unknown): string {
  const compact = compactText(value);
  if (
    !compact ||
    compact.length < 4 ||
    /^0+$/.test(compact) ||
    ['na', 'none', 'null', 'undefined', 'nonref', 'noref'].includes(compact)
  ) {
    return '';
  }
  return compact;
}

export function normalizeAccountCode(value: unknown): string {
  const source = cellText(value)
    .normalize('NFKC')
    .replace(BIDI_AND_ZERO_WIDTH, '')
    .toUpperCase()
    .replace(/_/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/-\d+$/, '')
    .replace(/^-|-$/g, '');
  return source;
}

export function currencyFromAccountCode(accountCode: string): string {
  const parts = accountCode.split('-');
  const currencyCode = parts.find((part) =>
    ['EG', 'US', 'EU', 'GB'].includes(part),
  );
  return (
    {
      EG: 'EGP',
      US: 'USD',
      EU: 'EUR',
      GB: 'GBP',
    }[currencyCode ?? ''] ?? ''
  );
}

export function meaningfulTerms(value: unknown): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((term) => term.length >= 2 && !USELESS_WORDS.has(term));
}

export function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number')
    return Number.isFinite(value) ? Math.abs(value) : null;
  const raw = cellText(value).trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[(),\s]/g, '').replace(/[^\d.+-]/g, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return Math.abs(negative ? -parsed : parsed);
}

export function chooseAmount(
  primary: unknown,
  secondary: unknown,
): number | null {
  const first = normalizeNumber(primary);
  if (first !== null && first > 0) return first;
  const second = normalizeNumber(secondary);
  return second !== null && second > 0 ? second : null;
}

export function normalizeDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(
      Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
    );
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + Math.floor(value) * 86_400_000);
  }
  const raw = cellText(value).trim();
  if (!raw) return null;

  const simple = raw.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})/);
  if (simple) {
    let year: number;
    let month: number;
    let day: number;
    if (simple[1].length === 4) {
      year = Number(simple[1]);
      month = Number(simple[2]);
      day = Number(simple[3]);
    } else {
      day = Number(simple[1]);
      month = Number(simple[2]);
      year = Number(simple[3]);
      if (year < 100) year += 2000;
    }
    const result = new Date(Date.UTC(year, month - 1, day));
    if (
      result.getUTCFullYear() === year &&
      result.getUTCMonth() === month - 1 &&
      result.getUTCDate() === day
    ) {
      return result;
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
}

export function toEpochDay(date: Date | null): number | null {
  return date ? Math.floor(date.getTime() / 86_400_000) : null;
}

export function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : '';
}
