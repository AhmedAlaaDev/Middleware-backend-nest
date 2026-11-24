import { normalizeSourceText } from './mas-revenue-workbook.parser';
import {
  MAS_REVENUE_HEADERS,
  MAS_REVENUE_LIMITS,
  type MasRevenueHeaderField,
} from './mas-revenue.constants';
import {
  MasRevenueCellValue,
  MasRevenueError,
  MasRevenueNormalizationResult,
  MasRevenueRawRow,
  MasRevenueReceipt,
  MasRevenueRowIssue,
  MasRevenueWorkbookParseResult,
} from './mas-revenue.types';

/** Fields a formula must never supply: they decide the accounting and the identity. */
const CRITICAL_FORMULA_FIELDS: MasRevenueHeaderField[] = [
  'transactionDate',
  'invoiceNumber',
  'value',
  'vat',
  'total',
  'cashAccountName',
  'customerName',
];

/** Float noise tolerance when reading a number cell as money (see parseMinor). */
const FLOAT_NOISE_TOLERANCE = 1e-6;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const EXCEL_MAX_SERIAL = 2_958_465; // 9999-12-31

/**
 * Turns classified rows into receipts. Every transaction row ends either as an
 * accepted receipt or as a rejected row with at least one issue. Nothing is
 * dropped silently.
 *
 * The workbook has no currency column. A receipt's currency is resolved later
 * from its verified D365 cash account (see the review service), so it is empty here.
 */
export function normalizeMasRevenueRows(
  parsed: MasRevenueWorkbookParseResult,
): MasRevenueNormalizationResult {
  const nonTransactionRows = { blank: 0, zeroPlaceholder: 0, cancelled: 0 };
  const transactionRows: MasRevenueRawRow[] = [];
  for (const row of parsed.rows) {
    if (row.classification === 'blank') nonTransactionRows.blank += 1;
    else if (row.classification === 'zero-placeholder')
      nonTransactionRows.zeroPlaceholder += 1;
    else if (row.classification === 'cancelled')
      nonTransactionRows.cancelled += 1;
    else transactionRows.push(row);
  }

  if (transactionRows.length > MAS_REVENUE_LIMITS.maxTransactionRows) {
    throw new MasRevenueError(
      `${transactionRows.length} transaction rows; the limit is ${MAS_REVENUE_LIMITS.maxTransactionRows}`,
    );
  }

  // Duplicate invoice numbers across the upload: every occurrence is blocked.
  const invoiceOccurrences = new Map<string, number[]>();
  for (const row of transactionRows) {
    const invoice = textValue(row.values.invoiceNumber);
    if (invoice === null) continue;
    const rows = invoiceOccurrences.get(invoice) ?? [];
    rows.push(row.sourceRow);
    invoiceOccurrences.set(invoice, rows);
  }

  const receipts: MasRevenueReceipt[] = [];
  const issues: MasRevenueRowIssue[] = [];
  let rejected = 0;

  for (const row of transactionRows) {
    const rowIssues: MasRevenueRowIssue[] = [];
    const issue = (
      field: MasRevenueHeaderField | null,
      message: string,
      original?: MasRevenueCellValue,
    ) => {
      rowIssues.push({
        sourceSheet: row.sourceSheet,
        sourceRow: row.sourceRow,
        column: field ? MAS_REVENUE_HEADERS[field] : null,
        originalValue: original === undefined ? null : describeValue(original),
        message,
      });
    };

    for (const field of row.formulaFields) {
      if (CRITICAL_FORMULA_FIELDS.includes(field)) {
        issue(
          field,
          'critical cell is a formula; store the value, not a formula',
          row.values[field],
        );
      }
    }

    if (
      textValue(row.values.creditColumn) !== null &&
      !isZeroNumber(row.values.creditColumn)
    ) {
      issue(
        'creditColumn',
        'credit column must be empty; this flow debits cash only',
        row.values.creditColumn,
      );
    }

    const invoiceNumber = textValue(row.values.invoiceNumber);
    if (invoiceNumber === null) {
      issue('invoiceNumber', 'invoice number is required');
    } else {
      if (invoiceNumber.length > MAS_REVENUE_LIMITS.maxInvoiceNumberLength) {
        issue(
          'invoiceNumber',
          `invoice number is longer than ${MAS_REVENUE_LIMITS.maxInvoiceNumberLength} characters`,
          row.values.invoiceNumber,
        );
      }
      const occurrences = invoiceOccurrences.get(invoiceNumber) ?? [];
      if (occurrences.length > 1) {
        const others = occurrences.filter((r) => r !== row.sourceRow);
        issue(
          'invoiceNumber',
          `duplicate invoice number in this upload (also row ${others.join(', ')}); correct or remove one`,
          row.values.invoiceNumber,
        );
      }
    }

    const transactionDate = toIsoDate(row.values.transactionDate);
    if (!transactionDate.ok) {
      issue(
        'transactionDate',
        transactionDate.message,
        row.values.transactionDate,
      );
    }

    const value = parseMinor(row.values.value);
    const vat = parseMinor(row.values.vat);
    const total = parseMinor(row.values.total);
    if (!value.ok) issue('value', value.message, row.values.value);
    if (!vat.ok) issue('vat', vat.message, row.values.vat);
    if (!total.ok) issue('total', total.message, row.values.total);

    if (value.ok && vat.ok && total.ok) {
      if (value.minor < 0 || vat.minor < 0) {
        issue('value', 'value and VAT must not be negative in this flow');
      }
      if (total.minor <= 0) {
        issue(
          'total',
          'zero or negative receipts are rejected; they are reported, not imported',
          row.values.total,
        );
      }
      if (value.minor + vat.minor !== total.minor) {
        issue(
          'total',
          `total must equal value + VAT; value ${formatMinor(value.minor)} + VAT ${formatMinor(vat.minor)} != total ${formatMinor(total.minor)}`,
          row.values.total,
        );
      }
    }

    const cashAccountDisplayName = textValue(row.values.cashAccountName);
    if (cashAccountDisplayName === null) {
      issue('cashAccountName', 'cash account (debit column) is required');
    }

    const customerName = textValue(row.values.customerName);
    if (customerName === null) {
      issue('customerName', 'customer name (Description column) is required');
    } else if (
      invoiceNumber !== null &&
      `${customerName} - ${invoiceNumber}`.length >
        MAS_REVENUE_LIMITS.maxTransactionTextLength
    ) {
      // The posted transaction text is "<customer> - <invoice>". Check the composed
      // text here so the review reports it before anything is submitted.
      issue(
        'customerName',
        `customer name and invoice number together are longer than ${MAS_REVENUE_LIMITS.maxTransactionTextLength} characters`,
        row.values.customerName,
      );
    }

    if (rowIssues.length > 0) {
      rejected += 1;
      issues.push(...rowIssues);
      continue;
    }

    receipts.push({
      sourceSheet: row.sourceSheet,
      sourceRow: row.sourceRow,
      invoiceNumber: invoiceNumber as string,
      transactionDate: (transactionDate as { ok: true; iso: string }).iso,
      currency: '',
      valueMinor: (value as { ok: true; minor: number }).minor,
      vatMinor: (vat as { ok: true; minor: number }).minor,
      totalMinor: (total as { ok: true; minor: number }).minor,
      cashAccountDisplayName: cashAccountDisplayName as string,
      customerName: customerName as string,
      containerType: textValue(row.values.containerType),
      containerNumber: textValue(row.values.containerNumber),
      billOfLading: textValue(row.values.billOfLading),
      revenueType: textValue(row.values.revenueType),
      seaLine: textValue(row.values.seaLine),
      vatCardNumber: textValue(row.values.vatCardNumber),
    });
  }

  return {
    receipts,
    issues,
    nonTransactionRows,
    accounting: {
      transactionRowsRead: transactionRows.length,
      accepted: receipts.length,
      rejected,
    },
  };
}

type MinorResult = { ok: true; minor: number } | { ok: false; message: string };
type DateResult = { ok: true; iso: string } | { ok: false; message: string };

function textValue(value: MasRevenueCellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = normalizeSourceText(value);
    return text === '' ? null : text;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

function isZeroNumber(value: MasRevenueCellValue | undefined): boolean {
  return (
    value === 0 ||
    (typeof value === 'string' && /^0+(\.0+)?$/.test(value.trim()))
  );
}

/**
 * Parses a money cell into integer minor units (cents).
 *
 * Text cells must be plain decimals with at most two places. Number cells are
 * accepted when they are within float noise of a two-place value: the source
 * stores VAT as 224.00000000000003, and that is 224.00 by design. Anything
 * farther from a cent value is rejected rather than rounded silently.
 */
export function parseMinor(
  value: MasRevenueCellValue | undefined,
): MinorResult {
  if (value === null || value === undefined || value === '') {
    return { ok: false, message: 'amount is required' };
  }
  if (value instanceof Date) {
    return { ok: false, message: 'amount must be a number, not a date' };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { ok: false, message: 'amount is not a finite number' };
    }
    const scaled = value * 100;
    const rounded = Math.round(scaled);
    if (Math.abs(scaled - rounded) > FLOAT_NOISE_TOLERANCE) {
      return {
        ok: false,
        message: `amount ${value} has more than two decimal places`,
      };
    }
    return checkRange(rounded);
  }
  const text = String(value).trim();
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    if (/^-?\d+\.\d{3,}$/.test(text)) {
      return {
        ok: false,
        message: `amount "${text}" has more than two decimal places`,
      };
    }
    return {
      ok: false,
      message: `amount "${text}" is not a plain decimal number`,
    };
  }
  const [, sign, whole, fraction = ''] = match;
  const magnitude = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return checkRange(sign ? -magnitude : magnitude);
}

function checkRange(minor: number): MinorResult {
  if (
    !Number.isSafeInteger(minor) ||
    Math.abs(minor) > MAS_REVENUE_LIMITS.maxAmountMinorUnits
  ) {
    return { ok: false, message: 'amount is outside the supported range' };
  }
  return { ok: true, minor };
}

/**
 * Converts a date cell to YYYY-MM-DD. Excel serials are converted with the
 * 1900 date system (1899-12-30 epoch); fractional serials are rejected rather
 * than truncated, so a time component never moves a receipt to another day.
 */
export function toIsoDate(value: MasRevenueCellValue | undefined): DateResult {
  if (value === null || value === undefined || value === '') {
    return { ok: false, message: 'transaction date is required' };
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return { ok: false, message: 'transaction date is not valid' };
    }
    return { ok: true, iso: value.toISOString().slice(0, 10) };
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1 || value > EXCEL_MAX_SERIAL) {
      return {
        ok: false,
        message: `date serial ${value} is not a whole Excel date`,
      };
    }
    const date = new Date(EXCEL_EPOCH_UTC + value * 86_400_000);
    return { ok: true, iso: date.toISOString().slice(0, 10) };
  }
  const text = String(value).trim();
  if (!ISO_DATE_PATTERN.test(text)) {
    return {
      ok: false,
      message: `date "${text}" must be YYYY-MM-DD or an Excel date`,
    };
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== text
  ) {
    return { ok: false, message: `date "${text}" is not a real calendar date` };
  }
  return { ok: true, iso: text };
}

function formatMinor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function describeValue(value: MasRevenueCellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
