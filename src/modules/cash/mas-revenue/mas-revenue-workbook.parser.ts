import ExcelJS from 'exceljs';

import {
  MAS_REVENUE_CANCEL_MARKER,
  MAS_REVENUE_HEADER_ALIASES,
  MAS_REVENUE_HEADERS,
  MAS_REVENUE_LIMITS,
  MAS_REVENUE_REQUIRED_HEADERS,
  MAS_REVENUE_SHEET_NAME,
  type MasRevenueHeaderField,
} from './mas-revenue.constants';
import {
  MasRevenueCellValue,
  MasRevenueError,
  MasRevenueRawRow,
  MasRevenueRowClassification,
  MasRevenueWorkbookParseResult,
} from './mas-revenue.types';

import {
  assertSafeXlsxArchive,
  YardInvoiceArchiveError,
} from '@/modules/cash/yard-invoice/yard-invoice-archive-guard';

const ALL_FIELDS = Object.keys(MAS_REVENUE_HEADERS) as MasRevenueHeaderField[];

/** Fields that identify a receipt. A row with none of these is a placeholder. */
const IDENTITY_FIELDS: MasRevenueHeaderField[] = [
  'invoiceNumber',
  'customerName',
  'cashAccountName',
  'containerType',
  'containerNumber',
  'billOfLading',
  'revenueType',
  'seaLine',
  'vatCardNumber',
];

const AMOUNT_FIELDS: MasRevenueHeaderField[] = ['value', 'vat', 'total'];

/** Collapses whitespace and normalizes Unicode composition; keeps Arabic text. */
export function normalizeSourceText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Reads the workbook and classifies every row. Money and date rules are
 * applied later by the normalizer; this layer only reads and classifies.
 * Rejects the file before parsing when the archive looks unsafe.
 */
export async function parseMasRevenueWorkbook(
  buffer: Buffer,
): Promise<MasRevenueWorkbookParseResult> {
  if (buffer.length > MAS_REVENUE_LIMITS.maxFileBytes) {
    throw new MasRevenueError(
      `file is larger than ${MAS_REVENUE_LIMITS.maxFileBytes / (1024 * 1024)} MB`,
    );
  }
  try {
    assertSafeXlsxArchive(buffer);
  } catch (error) {
    if (error instanceof YardInvoiceArchiveError) {
      throw new MasRevenueError(error.message);
    }
    throw error;
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new MasRevenueError('file could not be read as an .xlsx workbook');
  }

  const sheet = workbook.getWorksheet(MAS_REVENUE_SHEET_NAME);
  if (!sheet) {
    const names = workbook.worksheets.map((ws) => `"${ws.name}"`).join(', ');
    throw new MasRevenueError(
      `expected a sheet named "${MAS_REVENUE_SHEET_NAME}"; found ${names || 'none'}`,
    );
  }

  const headerRow = 1;
  const columnByField = resolveHeaderColumns(sheet, headerRow);

  const scanned = sheet.rowCount;
  if (scanned > MAS_REVENUE_LIMITS.maxScannedRows) {
    throw new MasRevenueError(
      `sheet has ${scanned} rows; the limit is ${MAS_REVENUE_LIMITS.maxScannedRows}`,
    );
  }

  const rows: MasRevenueRawRow[] = [];
  for (let rowNumber = headerRow + 1; rowNumber <= scanned; rowNumber += 1) {
    rows.push(readRow(sheet, rowNumber, columnByField));
  }

  return {
    sourceSheet: sheet.name,
    headerRow,
    columnByField,
    scannedRowCount: scanned,
    rows,
  };
}

function resolveHeaderColumns(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
): Partial<Record<MasRevenueHeaderField, number>> {
  // Every header text found in the row, with its column number.
  const headerTexts = new Map<number, string>();
  const headerCells = sheet.getRow(headerRow);
  headerCells.eachCell({ includeEmpty: false }, (cell, column) => {
    const text = normalizeSourceText(cellToText(cell.value) ?? '');
    if (text !== '') headerTexts.set(column, text);
  });

  const columnByField: Partial<Record<MasRevenueHeaderField, number>> = {};
  for (const field of ALL_FIELDS) {
    // The canonical English label, or an accepted older label for the same field.
    const accepted = new Set(
      [
        MAS_REVENUE_HEADERS[field],
        ...(MAS_REVENUE_HEADER_ALIASES[field] ?? []),
      ].map(normalizeSourceText),
    );
    const columns = [...headerTexts.entries()]
      .filter(([, text]) => accepted.has(text))
      .map(([column]) => column);
    if (columns.length > 1) {
      throw new MasRevenueError(
        `column "${MAS_REVENUE_HEADERS[field]}" appears ${columns.length} times; the column is ambiguous`,
      );
    }
    if (columns.length === 1) {
      columnByField[field] = columns[0];
    }
  }

  const missing = MAS_REVENUE_REQUIRED_HEADERS.filter(
    (field) => columnByField[field] === undefined,
  ).map((field) => `"${MAS_REVENUE_HEADERS[field]}"`);
  if (missing.length > 0) {
    throw new MasRevenueError(
      `required header(s) missing from row ${headerRow}: ${missing.join(', ')}`,
    );
  }
  return columnByField;
}

function readRow(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  columnByField: Partial<Record<MasRevenueHeaderField, number>>,
): MasRevenueRawRow {
  const row = sheet.getRow(rowNumber);
  const values = {} as Record<MasRevenueHeaderField, MasRevenueCellValue>;
  const formulaFields: MasRevenueHeaderField[] = [];

  for (const field of ALL_FIELDS) {
    const column = columnByField[field];
    if (column === undefined) {
      values[field] = null;
      continue;
    }
    const cell = row.getCell(column);
    if (isFormulaCell(cell.value)) {
      formulaFields.push(field);
    }
    values[field] = toCellValue(cell.value);
  }

  return {
    sourceSheet: sheet.name,
    sourceRow: rowNumber,
    classification: classifyRow(values),
    values,
    formulaFields,
  };
}

/**
 * Non-transaction rules come first: a CANCEL marker wins even when amounts are
 * present; then empty rows; then zero placeholders with no identity.
 */
export function classifyRow(
  values: Record<MasRevenueHeaderField, MasRevenueCellValue>,
): MasRevenueRowClassification {
  const debitText =
    typeof values.cashAccountName === 'string'
      ? values.cashAccountName.trim().toUpperCase()
      : '';
  if (debitText === MAS_REVENUE_CANCEL_MARKER) {
    return 'cancelled';
  }

  const hasIdentity = IDENTITY_FIELDS.some((field) => {
    const value = values[field];
    return value !== null && value !== '';
  });
  const amountsZeroOrEmpty = AMOUNT_FIELDS.every((field) =>
    isZeroOrEmpty(values[field]),
  );
  const hasDateOrOtherCell = ALL_FIELDS.some((field) => {
    const value = values[field];
    return value !== null && value !== '';
  });
  // A populated credit is never a placeholder: it must reach the normalizer and be rejected.
  const creditPopulated = !isZeroOrEmpty(values.creditColumn);

  if (!hasIdentity && amountsZeroOrEmpty && !creditPopulated) {
    return hasDateOrOtherCell ? 'zero-placeholder' : 'blank';
  }
  return 'transaction';
}

function isZeroOrEmpty(value: MasRevenueCellValue): boolean {
  if (value === null || value === '') return true;
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'string') return /^0+(\.0+)?$/.test(value.trim());
  return false;
}

function isFormulaCell(
  value: ExcelJS.CellValue,
): value is ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Date) &&
    ('formula' in value || 'sharedFormula' in value)
  );
}

function toCellValue(value: ExcelJS.CellValue): MasRevenueCellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return value;
  if (isFormulaCell(value)) {
    // Cached result keeps its type: a numeric result stays a number.
    const result = 'result' in value ? value.result : undefined;
    if (typeof result === 'number' || result instanceof Date) return result;
  }
  if (typeof value === 'string') {
    const text = normalizeSourceText(value);
    return text === '' ? null : text;
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const text = cellToText(value);
  if (text === null) return null;
  const normalized = normalizeSourceText(text);
  return normalized === '' ? null : normalized;
}

/** Reads display text from any ExcelJS cell value shape, formulas included (cached result). */
function cellToText(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value) {
      const result: unknown = value.result;
      if (typeof result === 'string') return result;
      if (typeof result === 'number' || typeof result === 'boolean') {
        return String(result);
      }
      if (result instanceof Date) return result.toISOString();
      return null;
    }
    if ('error' in value) return `#${String(value.error)}`;
  }
  return null;
}
