import ExcelJS from 'exceljs';

import {
  MAS_REVENUE_COMPANY_ID,
  MAS_REVENUE_FIELD_SPECS,
  MAS_REVENUE_HEADERS,
  MAS_REVENUE_LIMITS,
  MAS_REVENUE_SHEET_NAME,
  MAS_REVENUE_TEMPLATE_COLUMNS,
  MAS_REVENUE_TEMPLATE_VERSION,
  MAS_REVENUE_TEMPLATE_VERSION_LABEL,
  type MasRevenueFieldSpec,
} from './mas-revenue.constants';

const DATE_FORMAT = 'yyyy-mm-dd';
const AMOUNT_FORMAT = '#,##0.00';
const TEXT_FORMAT = '@';

/**
 * Builds the production upload template: a fresh workbook with the "Row Data"
 * sheet, the 14 contract headers, formats, a frozen header row and a filter.
 * It contains no transactions, no external links or connections, no macros,
 * no formulas and no placeholder rows, so a user starts with an empty sheet.
 * Nothing is copied from the source workbook.
 */
export async function buildMasRevenueTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'D365FO Middleware';
  workbook.company = MAS_REVENUE_COMPANY_ID.toUpperCase();

  const sheet = workbook.addWorksheet(MAS_REVENUE_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = MAS_REVENUE_TEMPLATE_COLUMNS.map((field) => {
    const spec = MAS_REVENUE_FIELD_SPECS[field];
    return {
      header: MAS_REVENUE_HEADERS[field],
      key: field,
      width: spec.width,
      style: { numFmt: formatFor(spec) },
    };
  });

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = {
    vertical: 'middle',
    horizontal: 'center',
    wrapText: true,
  };
  headerRow.height = 32;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7EEF7' },
    };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF8A9BB0' } } };
  });

  const lastColumn = String.fromCharCode(
    64 + MAS_REVENUE_TEMPLATE_COLUMNS.length,
  );
  sheet.autoFilter = { from: 'A1', to: `${lastColumn}1` };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function formatFor(spec: MasRevenueFieldSpec): string {
  switch (spec.kind) {
    case 'date':
      return DATE_FORMAT;
    case 'amount':
      return AMOUNT_FORMAT;
    case 'text':
      return TEXT_FORMAT;
  }
}

function requirementLabel(spec: MasRevenueFieldSpec): string {
  switch (spec.requirement) {
    case 'required':
      return 'Required';
    case 'optional':
      return 'Optional';
    case 'must-be-empty':
      return 'Must stay empty';
  }
}

function formatLabel(spec: MasRevenueFieldSpec): string {
  switch (spec.kind) {
    case 'date':
      return 'Excel date (yyyy-mm-dd) or text YYYY-MM-DD';
    case 'amount':
      return 'Number with at most 2 decimals; no thousands separators; no formula';
    case 'text':
      return 'Text. Keep leading zeros; do not convert to a number';
  }
}

/**
 * User guide for the upload contract. It is generated from the same column
 * metadata as the template, so the headers, requirements and examples cannot
 * drift from the template. It is plain Markdown.
 */
export function buildMasRevenueUploadGuide(): string {
  const rows = MAS_REVENUE_TEMPLATE_COLUMNS.map((field) => {
    const spec = MAS_REVENUE_FIELD_SPECS[field];
    const example =
      spec.example === '' ? '(leave empty)' : `\`${spec.example}\``;
    return `| ${MAS_REVENUE_HEADERS[field].trim()} | ${spec.meaning} | ${requirementLabel(spec)} | ${formatLabel(spec)} | ${example} |`;
  });

  return [
    `# MAS Revenue Cash In: upload template ${MAS_REVENUE_TEMPLATE_VERSION_LABEL}`,
    '',
    `Company: **MAS (${MAS_REVENUE_COMPANY_ID})**. Contract version ${MAS_REVENUE_TEMPLATE_VERSION}.`,
    '',
    '## How to fill the template',
    '',
    `1. Download the template. It has one sheet, **${MAS_REVENUE_SHEET_NAME}**. Keep that name.`,
    '2. Enter one receipt per row, starting on row 2. Do not add subtotal, total or note rows between receipts.',
    '3. Do not rename, reorder, insert or delete the 14 header columns.',
    '4. Choose the transaction currency in the upload screen. The file has no currency column.',
    '5. Upload the file and review the results. Fix every listed row, then upload again or create the batch.',
    '',
    '## Columns',
    '',
    'Use the English headers exactly as shown. Older source workbooks that use the Arabic labels for Date, Invoice No, Value, VAT, Total, VAT card no, Container no, Revenue type and Sea line are still read.',
    '',
    '| Exact header | Meaning | Requirement | Format | Example |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Rules that are checked',
    '',
    '- Value + VAT must equal Total exactly (to the cent). A total that differs is rejected.',
    '- VAT must equal the configured VAT rate of Value (for example 14% of 1,600.00 is 224.00). A row whose VAT differs is blocked from submission and named in the review.',
    '- Value and VAT must not be negative. Total must be greater than zero. Zero or negative receipts are reported and not imported.',
    '- Invoice No must be unique within the file. Every row with a duplicated invoice number is blocked until one is corrected or removed.',
    '- Invoice No is at most 60 characters. Customer name, the separator " - " and the invoice number together must fit in 100 characters.',
    '- Dates must be real calendar dates. A date with a time part is rejected, not truncated.',
    '- Formulas in the Date, Invoice No, Value, VAT, Total, debit or Description cells are rejected. Paste values, not formulas.',
    '- A populated credit column is rejected. This flow debits petty cash only.',
    '- A row with the text `CANCEL` in the debit column is cancelled and is not imported.',
    '- Blank rows and rows with only zero amounts are ignored and counted in the review.',
    '',
    '## Values the system supplies (not in the file)',
    '',
    '- **Currency** is chosen in the upload screen.',
    "- **Revenue account** is chosen by the row's Revenue type from the verified revenue-account configuration. There is no default revenue account.",
    '- **VAT account and rate** come from the verified MAS tax configuration. VAT is credited once, to that account.',
    '- **Cash account IDs**, **journal name**, dimensions, financial tags and exchange rates come from verified MAS configuration. They are not typed into the file.',
    '- If any of that configuration is missing or unverified, submission is blocked and the review says which item is missing.',
    '',
    '## Scope: direct cash revenue only',
    '',
    '- Each row is a receipt already paid in cash or bank. The Debit column names the cash account it was received into; it must be a configured cash account.',
    '- The Description column holds the customer name. It is never used to decide whether a receipt is cash or credit.',
    '- Credit-customer invoicing and later collection are **not supported** by this flow. A Debit value that is not in the verified cash-account configuration is reported as an unknown or unsupported cash account. A row is never treated as a credit sale because of its customer name or a failed lookup.',
    '',
    '## Limits',
    '',
    `- File size: ${MAS_REVENUE_LIMITS.maxFileBytes / (1024 * 1024)} MB maximum (.xlsx only).`,
    `- Transaction rows: ${MAS_REVENUE_LIMITS.maxTransactionRows} maximum per upload.`,
    '',
  ].join('\n');
}
