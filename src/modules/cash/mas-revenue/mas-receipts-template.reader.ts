import ExcelJS from 'exceljs';

import { loadWorkbook } from './mas-journal-template.parser';
import {
  MAS_RECEIPT_DISPLAY_HEADERS,
  MAS_RECEIPT_FIELDS,
  MAS_RECEIPT_HEADERS,
  MAS_RECEIPT_REQUIRED_FIELDS,
  MAS_RECEIPTS_MAX_HEADER_ROW,
  MAS_RECEIPTS_SHEET_NAME,
  MAS_REVENUE_TYPE_FIELDS,
  MAS_REVENUE_TYPE_HEADERS,
  MAS_REVENUE_TYPE_REQUIRED_FIELDS,
  MAS_REVENUE_TYPES_SHEET_NAME,
  type MasReceiptField,
  type MasRevenueTypeField,
} from './mas-receipts-template.constants';
import { parseMinor, toIsoDate } from './mas-revenue-normalizer';
import {
  cellToText,
  isFormulaCell,
  normalizeSourceText,
  toCellValue,
} from './mas-revenue-workbook.parser';
import { MAS_REVENUE_LIMITS } from './mas-revenue.constants';
import {
  type MasJournalLine,
  type MasRevenueCellValue,
  MasRevenueError,
  type MasRevenueNormalizationResult,
  type MasRevenueReceipt,
  type MasRevenueRowIssue,
} from './mas-revenue.types';

/** What a revenue type posts to, as finance states it on the Revenue Types sheet. */
export interface MasRevenueTypeMapping {
  sourceRow: number;
  revenueType: string;
  revenueAccount: string;
  itemSalesTaxGroup: string;
  salesTaxGroup: string;
  postingProfile: string;
  journalName: string;
}

interface SheetRow<F extends string> {
  sourceRow: number;
  values: Record<F, MasRevenueCellValue>;
  formulaFields: F[];
}

export interface MasReceiptsParseResult {
  sourceSheet: string;
  headerRow: number;
  scannedRowCount: number;
  receipts: Array<SheetRow<MasReceiptField>>;
  blankRows: number;
  revenueTypes: Array<SheetRow<MasRevenueTypeField>>;
}

/** True when the workbook is the receipts template (both sheets present). */
export async function isMasReceiptsWorkbook(buffer: Buffer): Promise<boolean> {
  const workbook = await loadWorkbook(buffer);
  return (
    workbook.getWorksheet(MAS_RECEIPTS_SHEET_NAME) !== undefined &&
    workbook.getWorksheet(MAS_REVENUE_TYPES_SHEET_NAME) !== undefined
  );
}

export async function parseMasReceiptsWorkbook(
  buffer: Buffer,
): Promise<MasReceiptsParseResult> {
  const workbook = await loadWorkbook(buffer);
  const receiptsSheet = requireSheet(workbook, MAS_RECEIPTS_SHEET_NAME);
  const typesSheet = requireSheet(workbook, MAS_REVENUE_TYPES_SHEET_NAME);

  const receipts = readSheet(
    receiptsSheet,
    MAS_RECEIPT_FIELDS,
    MAS_RECEIPT_HEADERS,
    MAS_RECEIPT_REQUIRED_FIELDS,
  );
  const types = readSheet(
    typesSheet,
    MAS_REVENUE_TYPE_FIELDS,
    MAS_REVENUE_TYPE_HEADERS,
    MAS_REVENUE_TYPE_REQUIRED_FIELDS,
  );
  return {
    sourceSheet: receiptsSheet.name,
    headerRow: receipts.headerRow,
    // The template formats hundreds of empty rows; only rows up to the last entry count.
    scannedRowCount: receipts.lastDataRow,
    receipts: receipts.rows,
    blankRows: receipts.blankRows,
    revenueTypes: types.rows,
  };
}

function requireSheet(
  workbook: ExcelJS.Workbook,
  name: string,
): ExcelJS.Worksheet {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new MasRevenueError(`expected a sheet named "${name}"`);
  return sheet;
}

function headerKey(value: unknown): string {
  // "Date *" marks a required column in the template; the mark is not part of the name.
  return normalizeSourceText(cellToText(value as never) ?? '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function readSheet<F extends string>(
  sheet: ExcelJS.Worksheet,
  fields: readonly F[],
  headers: Record<F, readonly string[]>,
  required: readonly F[],
): {
  headerRow: number;
  scanned: number;
  rows: Array<SheetRow<F>>;
  blankRows: number;
  lastDataRow: number;
} {
  const scanned = sheet.rowCount;
  if (scanned > MAS_REVENUE_LIMITS.maxScannedRows) {
    throw new MasRevenueError(
      `sheet "${sheet.name}" has ${scanned} rows; the limit is ${MAS_REVENUE_LIMITS.maxScannedRows}`,
    );
  }

  // The header is the first row (within the title band) that has every required header.
  let headerRow = 0;
  let columnByField: Partial<Record<F, number>> = {};
  for (let r = 1; r <= Math.min(MAS_RECEIPTS_MAX_HEADER_ROW, scanned); r += 1) {
    const texts = new Map<number, string>();
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, column) => {
      const text = headerKey(cell.value);
      if (text !== '') texts.set(column, text);
    });
    const found: Partial<Record<F, number>> = {};
    for (const field of fields) {
      const accepted = new Set(headers[field]);
      const columns = [...texts.entries()]
        .filter(([, text]) => accepted.has(text))
        .map(([column]) => column);
      if (columns.length > 1) {
        throw new MasRevenueError(
          `sheet "${sheet.name}": column "${headers[field][0]}" appears ${columns.length} times`,
        );
      }
      if (columns.length === 1) found[field] = columns[0];
    }
    if (required.every((field) => found[field] !== undefined)) {
      headerRow = r;
      columnByField = found;
      break;
    }
  }
  if (headerRow === 0) {
    throw new MasRevenueError(
      `sheet "${sheet.name}": the header row was not found; it needs ${required
        .map((field) => `"${headers[field][0]}"`)
        .join(', ')}`,
    );
  }

  const rows: Array<SheetRow<F>> = [];
  let blankRows = 0;
  let lastDataRow = headerRow;
  for (let r = headerRow + 1; r <= scanned; r += 1) {
    const row = sheet.getRow(r);
    const values = {} as Record<F, MasRevenueCellValue>;
    const formulaFields: F[] = [];
    for (const field of fields) {
      const column = columnByField[field];
      if (column === undefined) {
        values[field] = null;
        continue;
      }
      const cell = row.getCell(column);
      if (isFormulaCell(cell.value)) formulaFields.push(field);
      values[field] = toCellValue(cell.value);
    }
    const blank = fields.every(
      (field) => values[field] === null || values[field] === '',
    );
    if (blank) {
      blankRows += 1;
      continue;
    }
    rows.push({ sourceRow: r, values, formulaFields });
    lastDataRow = r;
  }
  // Blank rows after the last entry are formatting, not skipped receipts.
  blankRows -= scanned - lastDataRow;
  return { headerRow, scanned, rows, blankRows, lastDataRow };
}

function textOf(value: MasRevenueCellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = normalizeSourceText(value);
    return text === '' ? null : text;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

const typeKey = (value: string): string =>
  normalizeSourceText(value).toLowerCase();

/** Receipt fields a formula must not supply: they decide the accounting and identity. */
const CRITICAL_FORMULA_FIELDS: MasReceiptField[] = [
  'date',
  'invoiceNumber',
  'revenueType',
  'cashAccount',
  'value',
  'vat',
];

/**
 * Turns receipts into journal-line receipts. Each one is the line finance enters on
 * journal 271: the cash account debited with the total, the revenue type's account as
 * the offset, with the revenue type's tax groups, posting profile and journal.
 *
 * Only the shape is checked here. Whether the accounts and tax groups exist is checked
 * against D365 afterwards. Nothing is defaulted.
 */
export function normalizeMasReceipts(
  parsed: MasReceiptsParseResult,
): MasRevenueNormalizationResult & { mappings: MasRevenueTypeMapping[] } {
  const issues: MasRevenueRowIssue[] = [];

  // --- Revenue Types sheet ---------------------------------------------------
  const mappings: MasRevenueTypeMapping[] = [];
  const typeRows = new Map<string, number[]>();
  for (const row of parsed.revenueTypes) {
    const type = textOf(row.values.revenueType);
    if (type) {
      const key = typeKey(type);
      typeRows.set(key, [...(typeRows.get(key) ?? []), row.sourceRow]);
    }
  }
  const brokenTypes = new Set<string>();
  for (const row of parsed.revenueTypes) {
    const where = (column: string, message: string, value?: string) =>
      issues.push({
        sourceSheet: MAS_REVENUE_TYPES_SHEET_NAME,
        sourceRow: row.sourceRow,
        column,
        originalValue: value ?? null,
        message,
      });
    const type = textOf(row.values.revenueType);
    const account = textOf(row.values.revenueAccount);
    const itemTax = textOf(row.values.itemSalesTaxGroup);
    const journal = textOf(row.values.journalName);
    let ok = true;
    if (!type) {
      where('Revenue Type', 'revenue type is required');
      continue;
    }
    const key = typeKey(type);
    if ((typeRows.get(key) ?? []).length > 1) {
      where(
        'Revenue Type',
        `revenue type "${type}" is listed more than once; keep one row`,
        type,
      );
      ok = false;
    }
    if (!account) {
      where('Revenue Account', 'revenue account is required');
      ok = false;
    } else if (account.split('|')[0].trim() === '') {
      where(
        'Revenue Account',
        'the revenue account must start with its main account (for example 415701|2401|024|002|005)',
        account,
      );
      ok = false;
    }
    if (!itemTax) {
      where(
        'Item Sales Tax Group',
        'item sales tax group is required (for example Tax 14 or NONTAXABLE)',
      );
      ok = false;
    }
    if (!journal) {
      where(
        'Journal Name',
        'journal name is required (for example GL Journal)',
      );
      ok = false;
    }
    if (!ok) {
      brokenTypes.add(key);
      continue;
    }
    mappings.push({
      sourceRow: row.sourceRow,
      revenueType: type,
      revenueAccount: account as string,
      itemSalesTaxGroup: itemTax as string,
      salesTaxGroup: textOf(row.values.salesTaxGroup) ?? '',
      postingProfile: textOf(row.values.postingProfile) ?? '',
      journalName: journal as string,
    });
  }
  const mappingByType = new Map(
    mappings.map((mapping) => [typeKey(mapping.revenueType), mapping]),
  );

  // --- Receipts sheet --------------------------------------------------------
  if (parsed.receipts.length > MAS_REVENUE_LIMITS.maxTransactionRows) {
    throw new MasRevenueError(
      `${parsed.receipts.length} receipts; the limit is ${MAS_REVENUE_LIMITS.maxTransactionRows}`,
    );
  }
  const invoiceRows = new Map<string, number[]>();
  for (const row of parsed.receipts) {
    const invoice = textOf(row.values.invoiceNumber);
    if (invoice) {
      invoiceRows.set(invoice, [
        ...(invoiceRows.get(invoice) ?? []),
        row.sourceRow,
      ]);
    }
  }

  const receipts: MasRevenueReceipt[] = [];
  let rejected = 0;
  for (const row of parsed.receipts) {
    const rowIssues: MasRevenueRowIssue[] = [];
    const v = row.values;
    const issue = (
      field: MasReceiptField,
      message: string,
      original?: MasRevenueCellValue,
    ) =>
      rowIssues.push({
        sourceSheet: parsed.sourceSheet,
        sourceRow: row.sourceRow,
        column: headerLabel(field),
        originalValue:
          original === undefined || original === null
            ? null
            : original instanceof Date
              ? original.toISOString()
              : String(original),
        message,
      });

    for (const field of row.formulaFields) {
      if (CRITICAL_FORMULA_FIELDS.includes(field)) {
        issue(
          field,
          'this cell is a formula; enter the value itself',
          v[field],
        );
      }
    }

    const date = toIsoDate(v.date);
    if (!date.ok) issue('date', date.message, v.date);

    const invoice = textOf(v.invoiceNumber);
    if (!invoice) {
      issue('invoiceNumber', 'invoice number is required');
    } else {
      if (invoice.length > MAS_REVENUE_LIMITS.maxInvoiceNumberLength) {
        issue(
          'invoiceNumber',
          `invoice number is longer than ${MAS_REVENUE_LIMITS.maxInvoiceNumberLength} characters`,
          v.invoiceNumber,
        );
      }
      const same = invoiceRows.get(invoice) ?? [];
      if (same.length > 1) {
        issue(
          'invoiceNumber',
          `invoice ${invoice} appears more than once (also row ${same
            .filter((r) => r !== row.sourceRow)
            .join(', ')}); correct or remove one`,
          v.invoiceNumber,
        );
      }
    }

    const customer = textOf(v.customer);
    if (!customer) issue('customer', 'customer is required');

    const cash = textOf(v.cashAccount);
    if (!cash) {
      issue('cashAccount', 'cash account is required (for example Port Said)');
    } else if (cash.includes('|')) {
      issue(
        'cashAccount',
        'the cash account is the D365 cash ID only (for example Port Said)',
        v.cashAccount,
      );
    }

    const type = textOf(v.revenueType);
    let mapping: MasRevenueTypeMapping | undefined;
    if (!type) {
      issue('revenueType', 'revenue type is required');
    } else if (brokenTypes.has(typeKey(type))) {
      issue(
        'revenueType',
        `revenue type "${type}" has a problem on the Revenue Types sheet; fix it there`,
        v.revenueType,
      );
    } else {
      mapping = mappingByType.get(typeKey(type));
      if (!mapping) {
        issue(
          'revenueType',
          `revenue type "${type}" is not on the Revenue Types sheet`,
          v.revenueType,
        );
      }
    }

    const value = parseMinor(v.value);
    const vat = parseMinor(v.vat);
    const total = parseMinor(v.total);
    if (!value.ok) issue('value', value.message, v.value);
    else if (value.minor < 0)
      issue('value', 'value must not be negative', v.value);
    if (!vat.ok) issue('vat', vat.message, v.vat);
    else if (vat.minor < 0) issue('vat', 'VAT must not be negative', v.vat);
    if (!total.ok) issue('total', total.message, v.total);
    else if (total.minor <= 0) {
      issue('total', 'total must be greater than zero', v.total);
    }
    if (
      value.ok &&
      vat.ok &&
      total.ok &&
      value.minor + vat.minor !== total.minor
    ) {
      issue(
        'total',
        `Value + VAT is ${format(value.minor + vat.minor)}, but Total is ${format(total.minor)}`,
        v.total,
      );
    }

    const text = customer && invoice ? `${customer} - ${invoice}` : '';
    if (text.length > MAS_REVENUE_LIMITS.maxTransactionTextLength) {
      issue(
        'customer',
        `customer and invoice number together are longer than ${MAS_REVENUE_LIMITS.maxTransactionTextLength} characters`,
        v.customer,
      );
    }

    if (rowIssues.length > 0 || !mapping) {
      rejected += 1;
      issues.push(...rowIssues);
      continue;
    }

    const line: MasJournalLine = {
      journalName: mapping.journalName,
      accountType: 'RCash',
      account: cash as string,
      offsetAccountType: 'Ledger',
      offsetAccount: mapping.revenueAccount,
      side: 'debit',
      itemSalesTaxGroup: mapping.itemSalesTaxGroup,
      salesTaxGroup: mapping.salesTaxGroup,
      postingProfile: mapping.postingProfile,
      defaultDimension: '',
      offsetDefaultDimension: '',
      finTag: '',
      offsetFinTag: '',
      text,
      requestedCurrency: '',
    };
    receipts.push({
      sourceSheet: parsed.sourceSheet,
      sourceRow: row.sourceRow,
      invoiceNumber: invoice as string,
      transactionDate: (date as { ok: true; iso: string }).iso,
      currency: '',
      valueMinor: (value as { minor: number }).minor,
      vatMinor: (vat as { minor: number }).minor,
      totalMinor: (total as { minor: number }).minor,
      cashAccountDisplayName: cash as string,
      customerName: customer as string,
      containerType: textOf(v.containerType),
      containerNumber: textOf(v.containerNumber),
      billOfLading: textOf(v.billOfLading),
      revenueType: mapping.revenueType,
      seaLine: textOf(v.seaLine),
      vatCardNumber: textOf(v.vatCardNumber),
      journalLine: line,
    });
  }

  return {
    receipts,
    issues,
    nonTransactionRows: {
      blank: parsed.blankRows,
      zeroPlaceholder: 0,
      cancelled: 0,
    },
    accounting: {
      transactionRowsRead: parsed.receipts.length,
      accepted: receipts.length,
      rejected,
    },
    mappings,
  };
}

function headerLabel(field: MasReceiptField): string {
  return MAS_RECEIPT_DISPLAY_HEADERS[field];
}

function format(minor: number): string {
  return (minor / 100).toFixed(2);
}
