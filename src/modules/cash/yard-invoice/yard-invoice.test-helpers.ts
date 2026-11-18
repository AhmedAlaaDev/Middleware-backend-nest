import archiver from 'archiver';
import ExcelJS from 'exceljs';

import { YARDS_SOURCE_LAYOUTS } from './yard-invoice-source-workbook.parser';
import {
  YARD_INVOICE_TEMPLATE_HEADERS,
  YARD_INVOICE_TEMPLATE_SHEET,
} from './yard-invoice.constants';

/** Synthetic template row. Values are fixtures, not real Finance data. */
export interface TemplateFixtureRow {
  PaymentSerial?: unknown;
  PaymentDate?: unknown;
  'Payment Type'?: unknown;
  'PaymentNet Total'?: unknown;
  PaymentCurrency?: unknown;
  PaymentReference?: unknown;
  SAFE_BankAccount?: unknown;
  InvoiceNumber?: unknown;
}

export function baseRow(
  overrides: TemplateFixtureRow = {},
): TemplateFixtureRow {
  return {
    PaymentSerial: 'PS-0001',
    PaymentDate: '15-07-2026',
    'Payment Type': 'Cash',
    'PaymentNet Total': '1350.0001',
    PaymentCurrency: 'EGP',
    PaymentReference: 'REF-1',
    SAFE_BankAccount: 'Safe A',
    InvoiceNumber: '000061156/YD',
    ...overrides,
  };
}

export async function buildTemplateWorkbook(
  rows: TemplateFixtureRow[],
  options: {
    sheetName?: string;
    headers?: readonly string[];
    extraSheets?: string[];
  } = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(
    options.sheetName ?? YARD_INVOICE_TEMPLATE_SHEET,
  );
  const headers = options.headers ?? YARD_INVOICE_TEMPLATE_HEADERS;
  sheet.addRow([...headers]);
  for (const row of rows) {
    sheet.addRow(
      YARD_INVOICE_TEMPLATE_HEADERS.map(
        (header) => row[header as keyof TemplateFixtureRow],
      ),
    );
  }
  for (const name of options.extraSheets ?? []) {
    workbook.addWorksheet(name).addRow(['x']);
  }
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

/** Synthetic Yards source row, keyed by the layout's header names. */
export type YardsFixtureRow = Record<string, unknown>;

export function yardsRow(overrides: YardsFixtureRow = {}): YardsFixtureRow {
  return {
    'Payment Date': '15-07-2026',
    'Payment Type': 'CASH',
    'Net Total': 1350.0001,
    Cur: 'EGP       ',
    Currency: 'EGP       ',
    safe: 'Yard Safe',
    SAFE: 'Yard Safe',
    SAFE_BankAccount: 'Yard Safe',
    FREETEXTNUMBER: '000061156/YD',
    DEFAULTDIMENSIONDISPLAYVALUE:
      '|2401|024|002|012|101000262|101000262|||00002|3171|3171|Payable|||Domestic||||',
    HEADERFINTAGDISPLAYVALUE: '||MSC LINE|||MSNU7435730|0     ',
    CUSTOMERACCOUNT: '101000262',
    Customer: 'Synthetic Customer',
    'Payment Rmrk': '',
    ...overrides,
  };
}

/**
 * Builds a Yards source workbook. Each sheet names a layout id; its header row
 * is taken from that layout exactly, and each row supplies values by header name.
 */
export async function buildYardsSourceWorkbook(
  sheets: { name: string; layoutId: string; rows: YardsFixtureRow[] }[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const spec of sheets) {
    const layout = YARDS_SOURCE_LAYOUTS.find((l) => l.id === spec.layoutId);
    if (!layout) throw new Error(`unknown layout ${spec.layoutId}`);
    const sheet = workbook.addWorksheet(spec.name);
    sheet.addRow([...layout.headers]);
    for (const row of spec.rows) {
      sheet.addRow(layout.headers.map((header) => row[header]));
    }
  }
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

/** Builds a ZIP buffer with the given entries, for archive-guard tests. */
export function buildZip(
  entries: { name: string; content: Buffer }[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    for (const entry of entries) {
      archive.append(entry.content, { name: entry.name });
    }
    void archive.finalize();
  });
}
