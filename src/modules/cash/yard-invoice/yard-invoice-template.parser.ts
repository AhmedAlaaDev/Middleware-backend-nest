import ExcelJS from 'exceljs';

import {
  assertSafeXlsxArchive,
  YardInvoiceArchiveError,
} from './yard-invoice-archive-guard';
import {
  parseDecimalToMicro,
  YardInvoiceDecimalError,
  numericValueToMicro,
  Micro,
  assertWithinLimit,
} from './yard-invoice-decimal';
import {
  YARD_INVOICE_LIMITS,
  YARD_INVOICE_PAYMENT_TYPES,
  YARD_INVOICE_TEMPLATE_HEADERS,
  YardInvoiceTemplateHeader,
  YARD_INVOICE_TEMPLATE_SHEET,
} from './yard-invoice.constants';

export class YardInvoiceTemplateError extends Error {}

export interface YardInvoiceTemplateRow {
  /** 1-based worksheet row number, for operator-facing messages. */
  sourceRow: number;
  paymentSerial: string;
  /** Canonical calendar date, YYYY-MM-DD. */
  paymentDate: string;
  /** Canonical value from YARD_INVOICE_PAYMENT_TYPES. */
  paymentType: string;
  amount: Micro;
  amountText: string;
  currencyCode: string;
  paymentReference: string;
  safeBankAccount: string;
  /** Exact text after trimming surrounding whitespace only. */
  invoiceNumber: string;
}

export interface YardInvoiceTemplateIssue {
  sourceRow: number;
  column: YardInvoiceTemplateHeader | 'row';
  message: string;
}

export interface YardInvoiceTemplateParseResult {
  sheetName: string;
  rows: YardInvoiceTemplateRow[];
  issues: YardInvoiceTemplateIssue[];
  /** Data rows that had content (blank rows are skipped, not counted). */
  contentRowCount: number;
}

const COLUMN_INDEX = YARD_INVOICE_TEMPLATE_HEADERS.reduce<
  Record<string, number>
>((acc, header, index) => {
  acc[header] = index + 1;
  return acc;
}, {});

/**
 * Parses an uploaded template. Structural failures (not an xlsx, wrong sheet,
 * wrong headers, macros, too many rows, ZIP bomb) throw. Row-level problems
 * are returned as issues so the operator sees all of them at once.
 */
export async function parseYardInvoiceTemplate(
  buffer: Buffer<ArrayBufferLike>,
  options: { maxDataRows?: number } = {},
): Promise<YardInvoiceTemplateParseResult> {
  const maxRows = options.maxDataRows ?? YARD_INVOICE_LIMITS.maxDataRows;
  try {
    assertSafeXlsxArchive(buffer);
  } catch (error) {
    if (error instanceof YardInvoiceArchiveError) {
      throw new YardInvoiceTemplateError(error.message);
    }
    throw error;
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new YardInvoiceTemplateError(
      'file could not be read as an .xlsx workbook',
    );
  }

  const sheets = workbook.worksheets;
  if (sheets.length !== 1 || sheets[0].name !== YARD_INVOICE_TEMPLATE_SHEET) {
    throw new YardInvoiceTemplateError(
      `workbook must contain exactly one sheet named "${YARD_INVOICE_TEMPLATE_SHEET}"`,
    );
  }
  const sheet = sheets[0];

  const headerRow = sheet.getRow(1);
  const headers = YARD_INVOICE_TEMPLATE_HEADERS.map((_, index) =>
    cellText(headerRow.getCell(index + 1).value),
  );
  const expected = [...YARD_INVOICE_TEMPLATE_HEADERS];
  const sameOrder = expected.every(
    (header, index) => headers[index] === header,
  );
  if (!sameOrder) {
    throw new YardInvoiceTemplateError(
      `headers must be exactly, in order: ${expected.join(', ')}; found: ${headers.join(', ') || '(none)'}`,
    );
  }
  if (sheet.columnCount > expected.length) {
    const extra = headerRow.getCell(expected.length + 1).value;
    if (cellText(extra) !== '') {
      throw new YardInvoiceTemplateError(
        'unsupported extra column in template',
      );
    }
  }

  const rows: YardInvoiceTemplateRow[] = [];
  const issues: YardInvoiceTemplateIssue[] = [];
  let contentRowCount = 0;
  const lastRow = sheet.actualRowCount;

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const cells = expected.map((_, index) => row.getCell(index + 1).value);
    if (cells.every((value) => cellText(value) === '')) {
      continue;
    }
    contentRowCount++;
    if (contentRowCount > maxRows) {
      throw new YardInvoiceTemplateError(
        `template exceeds the ${maxRows} data row limit`,
      );
    }
    const parsed = parseRow(rowNumber, row, issues);
    if (parsed) {
      rows.push(parsed);
    }
  }

  return {
    sheetName: sheet.name,
    rows,
    issues,
    contentRowCount,
  };
}

function parseRow(
  sourceRow: number,
  row: ExcelJS.Row,
  issues: YardInvoiceTemplateIssue[],
): YardInvoiceTemplateRow | null {
  const failures: YardInvoiceTemplateIssue[] = [];
  const fail = (column: YardInvoiceTemplateHeader, message: string) =>
    failures.push({ sourceRow, column, message });
  const raw = (column: YardInvoiceTemplateHeader) =>
    row.getCell(COLUMN_INDEX[column]).value;

  for (const column of YARD_INVOICE_TEMPLATE_HEADERS) {
    if (isFormula(raw(column))) {
      fail(column, 'formulas are not allowed; enter the raw value');
    }
  }

  const invoiceNumber = textColumn(
    raw('InvoiceNumber'),
    'InvoiceNumber',
    fail,
    {
      max: YARD_INVOICE_LIMITS.maxInvoiceNumberLength,
      required: true,
    },
  );
  if (/-CN$/i.test(invoiceNumber)) {
    fail(
      'InvoiceNumber',
      'credit-note (-CN) invoices are not supported by the Yard cash receipt flow',
    );
  }
  const paymentSerial = textColumn(
    raw('PaymentSerial'),
    'PaymentSerial',
    fail,
    {
      max: YARD_INVOICE_LIMITS.maxSerialLength,
      required: true,
    },
  );
  const paymentReference = textColumn(
    raw('PaymentReference'),
    'PaymentReference',
    fail,
    { max: YARD_INVOICE_LIMITS.maxReferenceLength, required: false },
  );
  const safeBankAccount = textColumn(
    raw('SAFE_BankAccount'),
    'SAFE_BankAccount',
    fail,
    { max: YARD_INVOICE_LIMITS.maxSafeLength, required: true },
  );

  const paymentDate = parseDateCell(raw('PaymentDate'));
  if (!paymentDate) {
    fail('PaymentDate', 'use a real date (dd-mm-yyyy or ISO yyyy-mm-dd)');
  }

  const typeKey = cellText(raw('Payment Type')).toLowerCase();
  const paymentType = YARD_INVOICE_PAYMENT_TYPES[typeKey];
  if (!paymentType) {
    fail(
      'Payment Type',
      `unsupported payment type "${cellText(raw('Payment Type'))}"; accepted: Cash, Cheque, Check, Transfer, Deposit`,
    );
  }

  const currencyCode = cellText(raw('PaymentCurrency')).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    fail('PaymentCurrency', 'currency must be a 3-letter ISO code');
  }

  const amountCell = raw('PaymentNet Total');
  const amountText = cellText(amountCell);
  let amount: Micro | null = null;
  try {
    amount =
      typeof amountCell === 'number'
        ? numericValueToMicro(amountCell)
        : parseDecimalToMicro(amountText);
    assertWithinLimit(amount);
    if (amount <= 0n) {
      fail(
        'PaymentNet Total',
        'amount must be greater than zero; negative and credit-note values are not supported by this flow',
      );
    }
  } catch (error) {
    if (error instanceof YardInvoiceDecimalError) {
      fail('PaymentNet Total', error.message);
    } else {
      throw error;
    }
  }

  if (failures.length > 0) {
    issues.push(...failures);
    return null;
  }

  return {
    sourceRow,
    paymentSerial,
    paymentDate: paymentDate as string,
    paymentType,
    amount: amount as Micro,
    amountText,
    currencyCode,
    paymentReference,
    safeBankAccount,
    invoiceNumber,
  };
}

interface TextRule {
  max: number;
  required: boolean;
}

function textColumn(
  value: unknown,
  column: YardInvoiceTemplateHeader,
  fail: (column: YardInvoiceTemplateHeader, message: string) => void,
  rule: TextRule,
): string {
  if (typeof value === 'number' || typeof value === 'bigint') {
    fail(
      column,
      'must be stored as text; a numeric cell can lose leading zeros or exact digits',
    );
    return '';
  }
  if (value instanceof Date) {
    fail(column, 'must be stored as text, not as a date');
    return '';
  }
  const text = cellText(value).trim();
  if (!text) {
    if (rule.required) fail(column, 'value is required');
    return '';
  }
  if (text.length > rule.max) {
    fail(column, `longer than ${rule.max} characters`);
  }
  if (hasControlCharacters(text)) {
    fail(column, 'contains control characters');
  }
  return text;
}

/**
 * Accepts an Excel date cell (exceljs returns a Date for date-formatted
 * cells) or unambiguous text: dd-mm-yyyy (the Yard source convention) or
 * ISO yyyy-mm-dd. Anything else, including plain serial numbers, is rejected.
 */
export function parseDateCell(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toIsoDate(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }
  const text = cellText(value).trim();
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (dmy) {
    return toIsoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  return null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isFormula(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('formula' in value || 'sharedFormula' in value)
  );
}

/** Text of a cell with no numeric coercion. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint')
    return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (
      'richText' in value &&
      Array.isArray((value as { richText: unknown }).richText)
    ) {
      return (value as { richText: { text: string }[] }).richText
        .map((part) => part.text)
        .join('');
    }
    if (
      'text' in value &&
      typeof (value as { text: unknown }).text === 'string'
    ) {
      return (value as { text: string }).text;
    }
    if ('result' in value) {
      return cellText((value as { result: unknown }).result);
    }
    if ('error' in value) {
      return '#ERROR';
    }
  }
  return '';
}
