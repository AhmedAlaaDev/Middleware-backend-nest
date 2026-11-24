import ExcelJS from 'exceljs';

import {
  MAS_JOURNAL_FIELDS,
  MAS_JOURNAL_HEADERS,
  MAS_JOURNAL_REQUIRED_FIELDS,
  MAS_JOURNAL_SHEET_NAME,
  type MasJournalField,
} from './mas-journal-template.constants';
import {
  cellToText,
  isFormulaCell,
  normalizeSourceText,
  toCellValue,
} from './mas-revenue-workbook.parser';
import { MAS_REVENUE_LIMITS } from './mas-revenue.constants';
import { MasRevenueCellValue, MasRevenueError } from './mas-revenue.types';

import {
  assertSafeXlsxArchive,
  YardInvoiceArchiveError,
} from '@/modules/cash/yard-invoice/yard-invoice-archive-guard';

export interface MasJournalRawRow {
  sourceSheet: string;
  sourceRow: number;
  /** Blank rows are counted and skipped. Everything else goes to the normalizer. */
  classification: 'blank' | 'transaction';
  values: Record<MasJournalField, MasRevenueCellValue>;
  /** Fields whose cell holds a formula. Cached results are read. */
  formulaFields: MasJournalField[];
}

export interface MasJournalParseResult {
  sourceSheet: string;
  headerRow: number;
  scannedRowCount: number;
  rows: MasJournalRawRow[];
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
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
  return workbook;
}

/** True when the workbook has the version 2 sheet. Any other workbook is read as the source layout. */
export async function isMasJournalWorkbook(buffer: Buffer): Promise<boolean> {
  const workbook = await loadWorkbook(buffer);
  return workbook.getWorksheet(MAS_JOURNAL_SHEET_NAME) !== undefined;
}

export async function parseMasJournalWorkbook(
  buffer: Buffer,
): Promise<MasJournalParseResult> {
  const workbook = await loadWorkbook(buffer);
  const sheet = workbook.getWorksheet(MAS_JOURNAL_SHEET_NAME);
  if (!sheet) {
    throw new MasRevenueError(
      `expected a sheet named "${MAS_JOURNAL_SHEET_NAME}"`,
    );
  }

  const headerRow = 1;
  const columnByField = resolveColumns(sheet, headerRow);

  const scanned = sheet.rowCount;
  if (scanned > MAS_REVENUE_LIMITS.maxScannedRows) {
    throw new MasRevenueError(
      `sheet has ${scanned} rows; the limit is ${MAS_REVENUE_LIMITS.maxScannedRows}`,
    );
  }

  const rows: MasJournalRawRow[] = [];
  for (let rowNumber = headerRow + 1; rowNumber <= scanned; rowNumber += 1) {
    rows.push(readRow(sheet, rowNumber, columnByField));
  }
  return { sourceSheet: sheet.name, headerRow, scannedRowCount: scanned, rows };
}

function resolveColumns(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
): Partial<Record<MasJournalField, number>> {
  const headerTexts = new Map<number, string>();
  sheet.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, column) => {
    const text = normalizeSourceText(cellToText(cell.value) ?? '');
    if (text !== '') headerTexts.set(column, text.toUpperCase());
  });

  const columnByField: Partial<Record<MasJournalField, number>> = {};
  for (const field of MAS_JOURNAL_FIELDS) {
    const accepted = new Set<string>(MAS_JOURNAL_HEADERS[field]);
    const columns = [...headerTexts.entries()]
      .filter(([, text]) => accepted.has(text))
      .map(([column]) => column);
    if (columns.length > 1) {
      throw new MasRevenueError(
        `column "${MAS_JOURNAL_HEADERS[field][0]}" appears ${columns.length} times; the column is ambiguous`,
      );
    }
    if (columns.length === 1) columnByField[field] = columns[0];
  }

  const missing = MAS_JOURNAL_REQUIRED_FIELDS.filter(
    (field) => columnByField[field] === undefined,
  ).map((field) => `"${MAS_JOURNAL_HEADERS[field][0]}"`);
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
  columnByField: Partial<Record<MasJournalField, number>>,
): MasJournalRawRow {
  const row = sheet.getRow(rowNumber);
  const values = {} as Record<MasJournalField, MasRevenueCellValue>;
  const formulaFields: MasJournalField[] = [];
  for (const field of MAS_JOURNAL_FIELDS) {
    const column = columnByField[field];
    if (column === undefined) {
      values[field] = null;
      continue;
    }
    const cell = row.getCell(column);
    if (isFormulaCell(cell.value)) formulaFields.push(field);
    values[field] = toCellValue(cell.value);
  }
  const isBlank = MAS_JOURNAL_FIELDS.every((field) => {
    const value = values[field];
    return value === null || value === '';
  });
  return {
    sourceSheet: sheet.name,
    sourceRow: rowNumber,
    classification: isBlank ? 'blank' : 'transaction',
    values,
    formulaFields,
  };
}
