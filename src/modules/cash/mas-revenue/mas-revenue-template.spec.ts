import ExcelJS from 'exceljs';
import JSZip from 'jszip';

import { normalizeMasRevenueRows } from './mas-revenue-normalizer';
import {
  buildMasRevenueTemplate,
  buildMasRevenueUploadGuide,
} from './mas-revenue-template';
import { parseMasRevenueWorkbook } from './mas-revenue-workbook.parser';
import {
  MAS_REVENUE_FIELD_SPECS,
  MAS_REVENUE_HEADERS,
  MAS_REVENUE_SHEET_NAME,
  MAS_REVENUE_TEMPLATE_COLUMNS,
} from './mas-revenue.constants';

const EXPECTED_HEADERS = MAS_REVENUE_TEMPLATE_COLUMNS.map(
  (field) => MAS_REVENUE_HEADERS[field],
);

async function loadTemplate(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await buildMasRevenueTemplate()) as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );
  return workbook;
}

function fictionalRow(
  overrides: Partial<Record<number, ExcelJS.CellValue>> = {},
): ExcelJS.CellValue[] {
  const row: ExcelJS.CellValue[] = [
    '2026-10-28', // Date (text yyyy-mm-dd is accepted)
    '0012', // Invoice No, kept as text with its leading zeros
    1600, // Value
    224, // VAT
    1824, // Total
    '20DC', // TYPE
    'شركة اختبار', // Description (customer name), Arabic preserved
    '100000001', // VAT card no
    'ABCU1234567', // Container no
    'BL000001', // B/L
    'In', // Revenue type
    'Example Line', // Sea line
    'خزينة بور سعيد مصري', // debit (cash account name)
    null, // credit must stay empty
  ];
  for (const [index, value] of Object.entries(overrides)) {
    row[Number(index)] = value;
  }
  return row;
}

describe('MAS Revenue upload template', () => {
  it('has the Row Data sheet and the 14 contract headers in order', async () => {
    const workbook = await loadTemplate();
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([
      MAS_REVENUE_SHEET_NAME,
    ]);

    const headerRow = workbook.getWorksheet(MAS_REVENUE_SHEET_NAME)!.getRow(1);
    const headers = [] as string[];
    for (let column = 1; column <= 14; column += 1) {
      headers.push(headerRow.getCell(column).text);
    }
    expect(headers).toEqual(EXPECTED_HEADERS);
  });

  it('contains no transaction rows and no placeholder rows', async () => {
    const sheet = (await loadTemplate()).getWorksheet(MAS_REVENUE_SHEET_NAME)!;
    expect(sheet.rowCount).toBe(1);
  });

  it('applies date, amount and text formats to the matching columns', async () => {
    const sheet = (await loadTemplate()).getWorksheet(MAS_REVENUE_SHEET_NAME)!;
    MAS_REVENUE_TEMPLATE_COLUMNS.forEach((field, index) => {
      const spec = MAS_REVENUE_FIELD_SPECS[field];
      const expected =
        spec.kind === 'date'
          ? 'yyyy-mm-dd'
          : spec.kind === 'amount'
            ? '#,##0.00'
            : '@';
      expect({ field, numFmt: sheet.getColumn(index + 1).numFmt }).toEqual({
        field,
        numFmt: expected,
      });
    });
  });

  it('freezes the header row and filters the header range', async () => {
    const sheet = (await loadTemplate()).getWorksheet(MAS_REVENUE_SHEET_NAME)!;
    expect(sheet.views?.[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBe('A1:N1');
  });

  it('has no external links, connections, macros, embedded objects or formulas', async () => {
    const zip = await JSZip.loadAsync(await buildMasRevenueTemplate());
    const names = Object.keys(zip.files);
    for (const forbidden of [
      'externalLink',
      'connections',
      'vbaProject',
      'embeddings',
      'customXml',
    ]) {
      expect(names.filter((name) => name.includes(forbidden))).toEqual([]);
    }
    const sheetXml = await zip
      .file('xl/worksheets/sheet1.xml')!
      .async('string');
    expect(sheetXml).not.toMatch(/<f[ >]/);
  });

  it('parses as an empty upload that creates no transactions', async () => {
    const parsed = await parseMasRevenueWorkbook(
      await buildMasRevenueTemplate(),
    );
    expect(parsed.rows).toHaveLength(0);

    const result = normalizeMasRevenueRows(parsed);
    expect(result.receipts).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.accounting).toEqual({
      transactionRowsRead: 0,
      accepted: 0,
      rejected: 0,
    });
  });

  it('accepts one filled fictional row through the actual parser and normalizer', async () => {
    const workbook = await loadTemplate();
    const sheet = workbook.getWorksheet(MAS_REVENUE_SHEET_NAME)!;
    sheet.getRow(2).values = fictionalRow();
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const parsed = await parseMasRevenueWorkbook(buffer);
    const result = normalizeMasRevenueRows(parsed);

    expect(result.issues).toEqual([]);
    expect(result.receipts).toHaveLength(1);
    const receipt = result.receipts[0];
    expect(receipt.invoiceNumber).toBe('0012');
    expect(receipt.customerName).toBe('شركة اختبار');
    expect(receipt.cashAccountDisplayName).toBe('خزينة بور سعيد مصري');
    expect(receipt.totalMinor).toBe(182400);
    expect(receipt.transactionDate).toBe('2026-10-28');
  });

  it('writes monetary cells as numeric values, not formulas', async () => {
    const workbook = await loadTemplate();
    const sheet = workbook.getWorksheet(MAS_REVENUE_SHEET_NAME)!;
    sheet.getRow(2).values = fictionalRow();
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const reread = new ExcelJS.Workbook();
    await reread.xlsx.load(
      buffer as unknown as Parameters<typeof reread.xlsx.load>[0],
    );
    const row = reread.getWorksheet(MAS_REVENUE_SHEET_NAME)!.getRow(2);
    for (const column of [3, 4, 5]) {
      expect(typeof row.getCell(column).value).toBe('number');
    }
  });

  it('keeps rows that sit beyond the initial Excel table range', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(MAS_REVENUE_SHEET_NAME);
    sheet.addRow(EXPECTED_HEADERS);
    // The table covers rows 1 to 2 only.
    sheet.addTable({
      name: 'SourceTable',
      ref: 'A1',
      headerRow: true,
      columns: EXPECTED_HEADERS.map((name) => ({ name })),
      rows: [fictionalRow()],
    });
    // Filled after the table range, the way a user can extend a sheet.
    sheet.getRow(5).values = fictionalRow({
      1: '0013',
      2: 1000,
      3: 0,
      4: 1000,
    });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const parsed = await parseMasRevenueWorkbook(buffer);
    const result = normalizeMasRevenueRows(parsed);

    expect(result.accounting.transactionRowsRead).toBe(2);
    expect(result.receipts.map((r) => r.sourceRow).sort()).toEqual([2, 5]);
  });

  it('documents every column in the guide, with the exact header text', () => {
    const guide = buildMasRevenueUploadGuide();
    for (const header of EXPECTED_HEADERS) {
      expect(guide).toContain(`| ${header} |`);
    }
    expect(guide).toContain('Value + VAT must equal Total');
    expect(guide).toContain('`CANCEL`');
    expect(guide).toContain(
      'Choose the transaction currency in the upload screen',
    );
  });
});
