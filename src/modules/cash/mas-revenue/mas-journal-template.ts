import ExcelJS from 'exceljs';

import {
  MAS_JOURNAL_HEADERS,
  MAS_JOURNAL_LIMITS,
  MAS_JOURNAL_REQUIRED_FIELDS,
  MAS_JOURNAL_SHEET_NAME,
  MAS_JOURNAL_TEMPLATE_COLUMNS,
  MAS_JOURNAL_TEMPLATE_VERSION,
  type MasJournalField,
} from './mas-journal-template.constants';
import { MAS_REVENUE_COMPANY_ID } from './mas-revenue.constants';

const EXAMPLES_SHEET_NAME = 'Examples';

/** What each column means, for the guide and the header notes. */
const COLUMN_MEANING: Record<MasJournalField, string> = {
  journalName:
    'D365 journal name the line is entered in (for example GL Journal)',
  transactionDate: 'Transaction date (yyyy-mm-dd)',
  accountType: 'Type of the Account column: RCash (petty cash) or Ledger',
  account:
    'Account on the line: the cash ID, or a ledger account with dimensions',
  offsetAccountType: 'Type of the Offset account column: Ledger or RCash',
  offsetAccount:
    'Offset account: a ledger account with dimensions, or the cash ID',
  debit: 'Debit amount; leave empty when the line is a credit',
  credit: 'Credit amount; leave empty when the line is a debit',
  itemSalesTaxGroup:
    'Item sales-tax group of this entry (for example Tax 14 or NONTAXABLE)',
  document:
    'Document / invoice number; unique in the file and the line identity',
  text: 'Line text (optional; the document number is used when empty)',
  currency:
    'Optional check only: must equal the currency of the cash account in D365',
  postingProfile: 'Posting profile (optional; for example Cash)',
  salesTaxGroup: 'Sales-tax group (optional)',
  defaultDimension: 'Default dimension of the Account side, when it needs one',
  offsetDefaultDimension:
    'Default dimension of the Offset side, when it needs one',
  finTag: 'Financial tag of the Account side (optional)',
  offsetFinTag: 'Financial tag of the Offset side (optional)',
};

/**
 * Two lines copied from the finance team's own journals, shown only on the Examples
 * sheet. They are not part of the upload.
 */
const EXAMPLES: Array<Partial<Record<MasJournalField, string | number>>> = [
  {
    journalName: 'GL Journal',
    transactionDate: '2026-10-28',
    accountType: 'RCash',
    account: 'Port Said',
    offsetAccountType: 'Ledger',
    offsetAccount: '415701|2401|024|002|005',
    debit: 1824,
    itemSalesTaxGroup: 'Tax 14',
    document: 'EXAMPLE-IN-1',
    text: 'Example: money received into petty cash (cash on the account side, debit)',
    postingProfile: 'Cash',
  },
  {
    journalName: 'GL Journal',
    transactionDate: '2026-10-28',
    accountType: 'Ledger',
    account: '524528|2401|024|002',
    offsetAccountType: 'RCash',
    offsetAccount: 'Port Said',
    debit: 165,
    itemSalesTaxGroup: 'NONTAXABLE',
    document: 'EXAMPLE-OUT-1',
    text: 'Example: money paid out of petty cash (cash on the offset side, debit on the ledger)',
    offsetDefaultDimension: '|2401|024|002|005',
  },
];

const headerOf = (field: MasJournalField): string =>
  MAS_JOURNAL_HEADERS[field][0];

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.height = 32;
  row.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7EEF7' },
    };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF8A9BB0' } } };
  });
}

/**
 * The upload template (version 2): the "Journal Lines" sheet with the headers only,
 * and an "Examples" sheet that is never read. A row is one D365 journal line; whether it
 * is cash in or cash out is decided by which side the cash account is on and which
 * column holds the amount.
 */
export async function buildMasJournalTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'D365FO Middleware';
  workbook.company = MAS_REVENUE_COMPANY_ID.toUpperCase();

  const sheet = workbook.addWorksheet(MAS_JOURNAL_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = MAS_JOURNAL_TEMPLATE_COLUMNS.map((field) => ({
    header: headerOf(field),
    key: field,
    width: Math.max(16, headerOf(field).length + 4),
    style: {
      numFmt:
        field === 'debit' || field === 'credit'
          ? '#,##0.00'
          : field === 'transactionDate'
            ? 'yyyy-mm-dd'
            : '@',
    },
  }));
  styleHeader(sheet);
  const last = sheet.getRow(1).cellCount;
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: last },
  };

  const examples = workbook.addWorksheet(EXAMPLES_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  examples.columns = MAS_JOURNAL_TEMPLATE_COLUMNS.map((field) => ({
    header: headerOf(field),
    key: field,
    width: Math.max(16, headerOf(field).length + 4),
  }));
  styleHeader(examples);
  for (const example of EXAMPLES) examples.addRow(example);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Upload guide for version 2, generated from the same column metadata as the template. */
export function buildMasJournalUploadGuide(): string {
  const required = new Set<MasJournalField>(MAS_JOURNAL_REQUIRED_FIELDS);
  const rows = MAS_JOURNAL_TEMPLATE_COLUMNS.map(
    (field) =>
      `| ${headerOf(field)} | ${COLUMN_MEANING[field]} | ${required.has(field) ? 'Required' : 'Optional'} |`,
  );
  return [
    `# MAS petty-cash journal lines: upload template (version ${MAS_JOURNAL_TEMPLATE_VERSION})`,
    '',
    `Company: **MAS (${MAS_REVENUE_COMPANY_ID})**. One row is one D365 journal line, as the finance team enters it. The file carries the accounts, the amount side, the tax group and the journal; nothing about them is taken from configuration.`,
    '',
    '## How to fill the template',
    '',
    `1. Download the template. Keep the sheet name **${MAS_JOURNAL_SHEET_NAME}**; the **${EXAMPLES_SHEET_NAME}** sheet is never read.`,
    '2. Enter one journal line per row, starting on row 2.',
    '3. Exactly one side of the line is petty cash (RCash) and the other is a Ledger account.',
    '4. Put the amount in Debit or Credit, not both.',
    '',
    '## Cash in or cash out',
    '',
    'The direction is read from the row, not chosen anywhere:',
    '',
    '- Cash is the **Account** (RCash): a **debit** puts cash in, a **credit** takes cash out.',
    '- Cash is the **Offset account**: a **debit** on the ledger account takes cash out, a **credit** puts cash in.',
    '',
    '## Columns',
    '',
    '| Header | Meaning | Requirement |',
    '| --- | --- | --- |',
    ...rows,
    '',
    '## What is checked',
    '',
    '- The cash ID must exist in D365 as a petty-cash (RCash) account. Its currency is the currency of the line.',
    '- Every ledger main account and item sales-tax group must exist in D365.',
    '- The reporting exchange rate is read from D365 for the transaction date.',
    '- The Document number must be unique in the file; every row that repeats one is blocked.',
    `- Journal name is at most ${MAS_JOURNAL_LIMITS.maxJournalNameLength} characters; Document is at most ${MAS_JOURNAL_LIMITS.maxDocumentLength}.`,
    '- Amounts have at most 2 decimals and are not formulas.',
    '',
    'Nothing is sent to D365 until the batch is created and posted from the batch page.',
    '',
  ].join('\n');
}
