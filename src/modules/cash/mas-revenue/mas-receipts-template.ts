import ExcelJS from 'exceljs';

import {
  MAS_RECEIPT_DISPLAY_HEADERS,
  MAS_RECEIPT_REQUIRED_FIELDS,
  MAS_RECEIPTS_GUIDE_SHEET_NAME,
  MAS_RECEIPTS_SHEET_NAME,
  MAS_RECEIPTS_TEMPLATE_ROWS,
  MAS_RECEIPTS_TEMPLATE_VERSION,
  MAS_REVENUE_TYPE_DISPLAY_HEADERS,
  MAS_REVENUE_TYPE_REQUIRED_FIELDS,
  MAS_REVENUE_TYPES_SHEET_NAME,
  MAS_REVENUE_TYPES_TEMPLATE_ROWS,
  type MasReceiptField,
  type MasRevenueTypeField,
} from './mas-receipts-template.constants';
import { MAS_REVENUE_COMPANY_ID } from './mas-revenue.constants';

// Palette: navy title band, blue required headers, grey optional headers.
const NAVY = 'FF1F3864';
const REQUIRED_FILL = 'FFD9E2F3';
const OPTIONAL_FILL = 'FFEDEDED';
const BAND_REQUIRED = 'FF2F5597';
const BAND_OPTIONAL = 'FF7F7F7F';
const GRID = 'FFBFBFBF';
const ERROR_FILL = 'FFF8CBAD';

const HEADER_ROW = 4;
const FIRST_DATA_ROW = HEADER_ROW + 1;

/** Receipt columns in template order: what the receipt is, then reference data. */
const RECEIPT_COLUMNS: Array<{
  field: MasReceiptField;
  width: number;
  kind: 'date' | 'amount' | 'text';
  hint: string;
}> = [
  { field: 'date', width: 13, kind: 'date', hint: 'Receipt date, yyyy-mm-dd.' },
  {
    field: 'invoiceNumber',
    width: 13,
    kind: 'text',
    hint: 'Unique invoice number. The same invoice is never posted twice.',
  },
  {
    field: 'customer',
    width: 28,
    kind: 'text',
    hint: 'Customer name; used in the journal line text.',
  },
  {
    field: 'revenueType',
    width: 15,
    kind: 'text',
    hint: 'Pick a type from the Revenue Types sheet.',
  },
  {
    field: 'cashAccount',
    width: 15,
    kind: 'text',
    hint: 'D365 petty-cash ID the money was received into (for example Port Said).',
  },
  {
    field: 'value',
    width: 16,
    kind: 'amount',
    hint: 'Amount before VAT.',
  },
  { field: 'vat', width: 13, kind: 'amount', hint: 'VAT amount; 0 if none.' },
  {
    field: 'total',
    width: 15,
    kind: 'amount',
    hint: 'Value + VAT. This is the amount received into petty cash.',
  },
  {
    field: 'containerType',
    width: 14,
    kind: 'text',
    hint: 'Reference only (for example 20DC).',
  },
  {
    field: 'containerNumber',
    width: 16,
    kind: 'text',
    hint: 'Reference only.',
  },
  { field: 'billOfLading', width: 20, kind: 'text', hint: 'Reference only.' },
  { field: 'seaLine', width: 16, kind: 'text', hint: 'Reference only.' },
  { field: 'vatCardNumber', width: 14, kind: 'text', hint: 'Reference only.' },
];

const REVENUE_TYPE_COLUMNS: Array<{
  field: MasRevenueTypeField;
  width: number;
  hint: string;
}> = [
  { field: 'revenueType', width: 16, hint: 'Name used on the Receipts sheet.' },
  {
    field: 'revenueAccount',
    width: 30,
    hint: 'Ledger account with dimensions, for example 415701|2401|024|002|005.',
  },
  {
    field: 'itemSalesTaxGroup',
    width: 20,
    hint: 'Item sales tax group, for example Tax 14 or NONTAXABLE.',
  },
  {
    field: 'salesTaxGroup',
    width: 17,
    hint: 'Optional. Empty posts like journal GL-GNL-0000000000271; with a group, D365 calculates the tax.',
  },
  { field: 'postingProfile', width: 15, hint: 'Optional, for example Cash.' },
  {
    field: 'journalName',
    width: 15,
    hint: 'D365 journal name, for example GL Journal.',
  },
  { field: 'description', width: 50, hint: 'Free text for the reader.' },
];

/**
 * The one mapping row backed by evidence: finance journal GL-GNL-0000000000271
 * (revenue type "In", yard gate fees). Finance adds the other types.
 */
const EVIDENCED_REVENUE_TYPES: Array<
  Partial<Record<MasRevenueTypeField, string>>
> = [
  {
    revenueType: 'In',
    revenueAccount: '415701|2401|024|002|005',
    itemSalesTaxGroup: 'Tax 14',
    salesTaxGroup: '',
    postingProfile: 'Cash',
    journalName: 'GL Journal',
    description: 'Yard gate fees (as on journal GL-GNL-0000000000271)',
  },
];

function columnLetter(index: number): string {
  let n = index;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const side = { style: 'thin' as const, color: { argb: GRID } };
  return { top: side, left: side, bottom: side, right: side };
}

function titleBand(
  sheet: ExcelJS.Worksheet,
  lastColumn: number,
  title: string,
  subtitle: string,
  subtitleColumns: number = lastColumn,
): void {
  const last = columnLetter(lastColumn);
  sheet.mergeCells(`A1:${last}1`);
  const titleCell = sheet.getCell('A1');
  titleCell.value = title;
  titleCell.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: NAVY },
  };
  titleCell.alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(1).height = 28;

  sheet.mergeCells(`A2:${columnLetter(subtitleColumns)}2`);
  const sub = sheet.getCell('A2');
  sub.value = subtitle;
  sub.font = { italic: true, size: 10, color: { argb: 'FF595959' } };
  sub.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
  sheet.getRow(2).height = 30;
}

function headerCell(
  cell: ExcelJS.Cell,
  text: string,
  required: boolean,
  hint: string,
): void {
  cell.value = required ? `${text} *` : text;
  cell.font = { bold: true, color: { argb: 'FF1F1F1F' } };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: required ? REQUIRED_FILL : OPTIONAL_FILL },
  };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = thinBorder();
  cell.note = hint;
}

function buildReceiptsSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet(MAS_RECEIPTS_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: 2 }],
    properties: { tabColor: { argb: BAND_REQUIRED } },
  });
  const count = RECEIPT_COLUMNS.length;
  const required = new Set(MAS_RECEIPT_REQUIRED_FIELDS);
  const requiredCount = RECEIPT_COLUMNS.filter((c) =>
    required.has(c.field),
  ).length;

  titleBand(
    sheet,
    count,
    `MAS (${MAS_REVENUE_COMPANY_ID}) · Cash Receipts — Revenue received into petty cash`,
    'One row per receipt, from row 5. Columns marked * are required. Total must equal Value + VAT. Revenue Type comes from the Revenue Types sheet.',
    requiredCount,
  );

  // Live summary in the title band (outside the data rows).
  const lastRow = FIRST_DATA_ROW + MAS_RECEIPTS_TEMPLATE_ROWS - 1;
  const col = (field: MasReceiptField) =>
    columnLetter(RECEIPT_COLUMNS.findIndex((c) => c.field === field) + 1);
  const summary: Array<[string, string, string]> = [
    [
      'Receipts',
      `COUNTA(${col('invoiceNumber')}${FIRST_DATA_ROW}:${col('invoiceNumber')}${lastRow})`,
      '0',
    ],
    [
      'Value',
      `SUM(${col('value')}${FIRST_DATA_ROW}:${col('value')}${lastRow})`,
      '#,##0.00',
    ],
    [
      'VAT',
      `SUM(${col('vat')}${FIRST_DATA_ROW}:${col('vat')}${lastRow})`,
      '#,##0.00',
    ],
    [
      'Total',
      `SUM(${col('total')}${FIRST_DATA_ROW}:${col('total')}${lastRow})`,
      '#,##0.00',
    ],
  ];
  // Summary: labels in row 2, live figures in row 3, to the right of the subtitle.
  summary.forEach(([label, formula, format], i) => {
    const column = requiredCount + 1 + i;
    if (column > count) return;
    const labelCell = sheet.getCell(2, column);
    labelCell.value = label;
    labelCell.font = { size: 9, bold: true, color: { argb: 'FF595959' } };
    labelCell.alignment = { horizontal: 'center', vertical: 'bottom' };
    const cell = sheet.getCell(3, column);
    cell.value = { formula, result: 0 } as ExcelJS.CellFormulaValue;
    cell.numFmt = format;
    cell.font = { bold: true, color: { argb: NAVY } };
    cell.alignment = { horizontal: 'center' };
    cell.border = { bottom: { style: 'medium', color: { argb: NAVY } } };
  });

  // Group bands: what is posted, and reference data that is only kept.
  sheet.mergeCells(`A3:${columnLetter(requiredCount)}3`);
  const bandA = sheet.getCell('A3');
  bandA.value = 'RECEIPT — posted to D365';
  bandA.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  bandA.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BAND_REQUIRED },
  };
  bandA.alignment = { horizontal: 'center' };
  const referenceStart = requiredCount + summary.length + 1;
  if (referenceStart <= count) {
    const bandB = sheet.getCell(3, referenceStart);
    bandB.value = 'REFERENCE — kept, not posted';
    bandB.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    bandB.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: BAND_OPTIONAL },
    };
    bandB.alignment = { horizontal: 'center', wrapText: true };
  }

  RECEIPT_COLUMNS.forEach((column, index) => {
    const c = index + 1;
    sheet.getColumn(c).width = column.width;
    headerCell(
      sheet.getCell(HEADER_ROW, c),
      MAS_RECEIPT_DISPLAY_HEADERS[column.field],
      required.has(column.field),
      column.hint,
    );
  });
  sheet.getRow(HEADER_ROW).height = 32;

  // Data area: formats, borders and validation for the template rows.
  for (let r = FIRST_DATA_ROW; r <= lastRow; r += 1) {
    RECEIPT_COLUMNS.forEach((column, index) => {
      const cell = sheet.getCell(r, index + 1);
      cell.border = thinBorder();
      if (column.kind === 'date') cell.numFmt = 'yyyy-mm-dd';
      else if (column.kind === 'amount') cell.numFmt = '#,##0.00';
      else cell.numFmt = '@';
    });
  }
  const range = (field: MasReceiptField) =>
    `${col(field)}${FIRST_DATA_ROW}:${col(field)}${lastRow}`;
  const validate = (
    field: MasReceiptField,
    rule: ExcelJS.DataValidation,
  ): void => {
    for (let r = FIRST_DATA_ROW; r <= lastRow; r += 1) {
      sheet.getCell(`${col(field)}${r}`).dataValidation = rule;
    }
  };
  validate('revenueType', {
    type: 'list',
    allowBlank: true,
    formulae: [
      `'${MAS_REVENUE_TYPES_SHEET_NAME}'!$A$5:$A$${4 + MAS_REVENUE_TYPES_TEMPLATE_ROWS}`,
    ],
    showErrorMessage: true,
    errorTitle: 'Revenue type',
    error: 'Choose a revenue type listed on the Revenue Types sheet.',
  });
  validate('date', {
    type: 'date',
    operator: 'greaterThan',
    allowBlank: true,
    formulae: [new Date(Date.UTC(2000, 0, 1))],
    showErrorMessage: true,
    errorTitle: 'Date',
    error: 'Enter a date (yyyy-mm-dd).',
  });
  for (const field of ['value', 'vat'] as const) {
    validate(field, {
      type: 'decimal',
      operator: 'greaterThanOrEqual',
      allowBlank: true,
      formulae: [0],
      showErrorMessage: true,
      errorTitle: 'Amount',
      error: 'Enter a number of 0 or more, with at most 2 decimals.',
    });
  }
  validate('total', {
    type: 'decimal',
    operator: 'greaterThan',
    allowBlank: true,
    formulae: [0],
    showErrorMessage: true,
    errorTitle: 'Total',
    error: 'Total must be greater than 0 and equal Value + VAT.',
  });

  // Total that differs from Value + VAT is shown in red.
  sheet.addConditionalFormatting({
    ref: range('total'),
    rules: [
      {
        type: 'expression',
        priority: 1,
        formulae: [
          `AND(${col('total')}${FIRST_DATA_ROW}<>"",ROUND(${col('value')}${FIRST_DATA_ROW}+${col('vat')}${FIRST_DATA_ROW}-${col('total')}${FIRST_DATA_ROW},2)<>0)`,
        ],
        style: {
          fill: {
            type: 'pattern',
            pattern: 'solid',
            bgColor: { argb: ERROR_FILL },
          },
          font: { color: { argb: 'FF9C0006' }, bold: true },
        },
      },
    ],
  });

  sheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW, column: count },
  };
}

function buildRevenueTypesSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet(MAS_REVENUE_TYPES_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: HEADER_ROW }],
    properties: { tabColor: { argb: NAVY } },
  });
  const count = REVENUE_TYPE_COLUMNS.length;
  const required = new Set(MAS_REVENUE_TYPE_REQUIRED_FIELDS);
  titleBand(
    sheet,
    count,
    'Revenue Types — what each type posts to (maintained by finance)',
    'Each receipt debits its cash account with the Total and credits the Revenue Account of its type. Accounts and tax groups are checked in D365 before posting; nothing is posted with an unknown value.',
  );
  sheet.mergeCells(`A3:${columnLetter(count)}3`);
  const band = sheet.getCell('A3');
  band.value = 'POSTING SETUP';
  band.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  band.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BAND_REQUIRED },
  };
  band.alignment = { horizontal: 'center' };

  REVENUE_TYPE_COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
    headerCell(
      sheet.getCell(HEADER_ROW, index + 1),
      MAS_REVENUE_TYPE_DISPLAY_HEADERS[column.field],
      required.has(column.field),
      column.hint,
    );
  });
  sheet.getRow(HEADER_ROW).height = 32;

  const lastRow = FIRST_DATA_ROW + MAS_REVENUE_TYPES_TEMPLATE_ROWS - 1;
  for (let r = FIRST_DATA_ROW; r <= lastRow; r += 1) {
    REVENUE_TYPE_COLUMNS.forEach((column, index) => {
      const cell = sheet.getCell(r, index + 1);
      cell.border = thinBorder();
      cell.numFmt = '@';
    });
  }
  EVIDENCED_REVENUE_TYPES.forEach((mapping, i) => {
    REVENUE_TYPE_COLUMNS.forEach((column, index) => {
      const value = mapping[column.field];
      if (value !== undefined && value !== '') {
        sheet.getCell(FIRST_DATA_ROW + i, index + 1).value = value;
      }
    });
  });
}

const GUIDE_LINES: Array<[string, string]> = [
  ['What this file does', ''],
  [
    '',
    'Each row on the Receipts sheet is money received into a MAS petty-cash account. The middleware turns it into one line on a D365 general journal: the cash account is debited with the Total and the revenue account of its Revenue Type is the offset, exactly like finance journal GL-GNL-0000000000271.',
  ],
  ['Steps', ''],
  [
    '1',
    'Check the Revenue Types sheet: every type you use must be listed with its revenue account, item sales tax group and journal name.',
  ],
  [
    '2',
    'Enter one receipt per row on the Receipts sheet, starting on row 5. Do not add total or note rows between receipts.',
  ],
  [
    '3',
    'Upload the file in Cash In → MAS Revenue Cash In. Fix any row the review lists and upload again.',
  ],
  [
    '4',
    'Post the batch to D365 from the batch page. The journal is created unposted; finance posts it in D365.',
  ],
  ['Checks', ''],
  [
    '',
    'Total must equal Value + VAT, to the cent. Value and VAT cannot be negative.',
  ],
  [
    '',
    'An invoice number can appear only once in a file, and an invoice already uploaded cannot be uploaded again.',
  ],
  [
    '',
    'The cash account must exist in D365 as a petty-cash account; its currency is the currency of the receipt.',
  ],
  [
    '',
    'The revenue account, its main account and the item sales tax group must exist in D365.',
  ],
  ['', 'The reporting exchange rate is read from D365 for the receipt date.'],
  ['VAT', ''],
  [
    '',
    'The amount posted is the Total (VAT included), as on journal GL-GNL-0000000000271. Whether D365 separates the VAT depends on the tax groups on the Revenue Types sheet; finance decides them.',
  ],
  ['Reference columns', ''],
  [
    '',
    'Container Type, Container No, B/L, Sea Line and VAT Card No are kept with the batch for reference. They are not posted to D365.',
  ],
];

function buildGuideSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet(MAS_RECEIPTS_GUIDE_SHEET_NAME, {
    properties: { tabColor: { argb: BAND_OPTIONAL } },
  });
  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 110;
  titleBand(
    sheet,
    2,
    'How to use this template',
    `Template version ${MAS_RECEIPTS_TEMPLATE_VERSION}. Sheets: ${MAS_RECEIPTS_SHEET_NAME} (users), ${MAS_REVENUE_TYPES_SHEET_NAME} (finance).`,
  );
  let r = 4;
  for (const [label, text] of GUIDE_LINES) {
    const a = sheet.getCell(r, 1);
    const b = sheet.getCell(r, 2);
    if (text === '') {
      a.value = label;
      a.font = { bold: true, color: { argb: NAVY }, size: 12 };
      r += 1;
      continue;
    }
    a.value = label;
    a.alignment = { horizontal: 'right', vertical: 'top' };
    a.font = { bold: true };
    b.value = text;
    b.alignment = { wrapText: true, vertical: 'top' };
    r += 1;
  }
}

/** The receipts template (version 3): Receipts, Revenue Types and How to use. */
export async function buildMasReceiptsTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'D365FO Middleware';
  workbook.company = MAS_REVENUE_COMPANY_ID.toUpperCase();
  workbook.calcProperties = { fullCalcOnLoad: true };
  buildReceiptsSheet(workbook);
  buildRevenueTypesSheet(workbook);
  buildGuideSheet(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** The same guide as Markdown, for the guide download. */
export function buildMasReceiptsGuide(): string {
  const lines = [
    `# MAS Cash Receipts template (version ${MAS_RECEIPTS_TEMPLATE_VERSION})`,
    '',
  ];
  for (const [label, text] of GUIDE_LINES) {
    if (text === '') lines.push('', `## ${label}`, '');
    else lines.push(label ? `${label}. ${text}` : `- ${text}`);
  }
  lines.push(
    '',
    '## Receipts columns',
    '',
    '| Column | Required | Meaning |',
    '| --- | --- | --- |',
    ...RECEIPT_COLUMNS.map(
      (c) =>
        `| ${MAS_RECEIPT_DISPLAY_HEADERS[c.field]} | ${MAS_RECEIPT_REQUIRED_FIELDS.includes(c.field) ? 'Yes' : 'No'} | ${c.hint} |`,
    ),
    '',
    '## Revenue Types columns',
    '',
    '| Column | Required | Meaning |',
    '| --- | --- | --- |',
    ...REVENUE_TYPE_COLUMNS.map(
      (c) =>
        `| ${MAS_REVENUE_TYPE_DISPLAY_HEADERS[c.field]} | ${MAS_REVENUE_TYPE_REQUIRED_FIELDS.includes(c.field) ? 'Yes' : 'No'} | ${c.hint} |`,
    ),
    '',
  );
  return lines.join('\n');
}
