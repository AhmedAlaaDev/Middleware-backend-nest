import ExcelJS from 'exceljs';

import { parseMasRevenueWorkbook } from './mas-revenue-workbook.parser';
import {
  MAS_REVENUE_HEADER_ALIASES,
  MAS_REVENUE_HEADERS,
  MAS_REVENUE_SHEET_NAME,
} from './mas-revenue.constants';
import { MasRevenueError } from './mas-revenue.types';

const HEADER_ROW: string[] = [
  MAS_REVENUE_HEADERS.transactionDate,
  MAS_REVENUE_HEADERS.invoiceNumber,
  MAS_REVENUE_HEADERS.value,
  MAS_REVENUE_HEADERS.vat,
  MAS_REVENUE_HEADERS.total,
  MAS_REVENUE_HEADERS.containerType,
  MAS_REVENUE_HEADERS.customerName,
  MAS_REVENUE_HEADERS.vatCardNumber,
  MAS_REVENUE_HEADERS.containerNumber,
  MAS_REVENUE_HEADERS.billOfLading,
  MAS_REVENUE_HEADERS.revenueType,
  MAS_REVENUE_HEADERS.seaLine,
  MAS_REVENUE_HEADERS.cashAccountName,
  MAS_REVENUE_HEADERS.creditColumn,
];

const CASH_ACCOUNT = 'خزينة بور سعيد مصري';

async function buildWorkbook(
  rows: Array<Array<unknown>>,
  options: { sheetName?: string; headers?: string[] } = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(
    options.sheetName ?? MAS_REVENUE_SHEET_NAME,
  );
  sheet.addRow(options.headers ?? HEADER_ROW);
  for (const row of rows) {
    sheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function transactionRow(
  overrides: Partial<Record<number, unknown>> = {},
): unknown[] {
  const base: unknown[] = [
    46323, // 2026-10-28
    '1',
    1600,
    224,
    1824,
    '20DC',
    'GIVAUDAN EGYPT',
    '100497772',
    'SEKU1165565',
    'HLCUIZ1260983630',
    'In',
    'Habag Lloyd',
    CASH_ACCOUNT,
    null,
  ];
  for (const [index, value] of Object.entries(overrides)) {
    base[Number(index)] = value;
  }
  return base;
}

describe('parseMasRevenueWorkbook', () => {
  it('maps headers by text and reads the Row Data sheet', async () => {
    const buffer = await buildWorkbook([transactionRow()]);

    const parsed = await parseMasRevenueWorkbook(buffer);

    expect(parsed.sourceSheet).toBe(MAS_REVENUE_SHEET_NAME);
    expect(parsed.headerRow).toBe(1);
    expect(parsed.columnByField.invoiceNumber).toBe(2);
    expect(parsed.columnByField.cashAccountName).toBe(13);
    expect(parsed.scannedRowCount).toBe(2);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].classification).toBe('transaction');
    expect(parsed.rows[0].values.cashAccountName).toBe(CASH_ACCOUNT);
  });

  it('keeps identifiers as text, including leading zeros and Arabic text', async () => {
    const buffer = await buildWorkbook([
      transactionRow({ 1: '0012', 10: 'In  ' }),
    ]);

    const parsed = await parseMasRevenueWorkbook(buffer);

    expect(parsed.rows[0].values.invoiceNumber).toBe('0012');
    expect(parsed.rows[0].values.revenueType).toBe('In');
    expect(parsed.rows[0].values.cashAccountName).toBe(CASH_ACCOUNT);
  });

  it('accepts headers that appear in a different column order', async () => {
    const reversed = [...HEADER_ROW].reverse();
    const rowInReverse = [...transactionRow()].reverse();
    const buffer = await buildWorkbook([rowInReverse], { headers: reversed });

    const parsed = await parseMasRevenueWorkbook(buffer);

    expect(parsed.rows[0].classification).toBe('transaction');
    expect(parsed.rows[0].values.invoiceNumber).toBe('1');
    expect(parsed.rows[0].values.total).toBe(1824);
  });

  it('classifies blank, zero placeholder, cancelled and transaction rows', async () => {
    const buffer = await buildWorkbook([
      transactionRow(),
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
      [
        46325,
        null,
        0,
        0,
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
      [
        null,
        '7',
        500,
        70,
        570,
        null,
        'SOMEONE',
        null,
        null,
        null,
        null,
        null,
        'CANCEL',
        null,
      ],
      [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        'x',
      ],
    ]);

    const parsed = await parseMasRevenueWorkbook(buffer);
    const classes = parsed.rows.map((row) => row.classification);

    expect(classes).toEqual([
      'transaction',
      'blank',
      'zero-placeholder',
      'cancelled',
      'transaction',
    ]);
  });

  it('marks a formula in a critical cell without evaluating it', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(MAS_REVENUE_SHEET_NAME);
    sheet.addRow(HEADER_ROW);
    const row = sheet.addRow(transactionRow());
    row.getCell(5).value = {
      formula: 'C2+D2',
      result: 1824,
    } as ExcelJS.CellFormulaValue;
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const parsed = await parseMasRevenueWorkbook(buffer);

    expect(parsed.rows[0].formulaFields).toEqual(['total']);
    expect(parsed.rows[0].values.total).toBe(1824);
  });

  it('refuses a workbook whose sheet is not named Row Data', async () => {
    const buffer = await buildWorkbook([transactionRow()], {
      sheetName: 'Sheet1',
    });

    await expect(parseMasRevenueWorkbook(buffer)).rejects.toThrow(
      /expected a sheet named "Row Data"; found "Sheet1"/,
    );
  });

  it('refuses a workbook missing a required header, naming it', async () => {
    const headers = HEADER_ROW.filter((h) => h !== MAS_REVENUE_HEADERS.vat);
    const buffer = await buildWorkbook([], { headers });

    await expect(parseMasRevenueWorkbook(buffer)).rejects.toThrow(
      MasRevenueError,
    );
    await expect(parseMasRevenueWorkbook(buffer)).rejects.toThrow(/"VAT"/);
  });

  it('still reads the historical Arabic source layout through the aliases', async () => {
    const arabic = HEADER_ROW.map((header) => {
      const field = Object.keys(MAS_REVENUE_HEADERS).find(
        (key) =>
          MAS_REVENUE_HEADERS[key as keyof typeof MAS_REVENUE_HEADERS] ===
          header,
      ) as keyof typeof MAS_REVENUE_HEADERS;
      return MAS_REVENUE_HEADER_ALIASES[field]?.[0] ?? header;
    });
    const buffer = await buildWorkbook([transactionRow()], { headers: arabic });

    const parsed = await parseMasRevenueWorkbook(buffer);

    expect(parsed.rows[0].classification).toBe('transaction');
    expect(parsed.rows[0].values.invoiceNumber).toBe('1');
    expect(parsed.rows[0].values.total).toBe(1824);
  });

  it('refuses a column that carries both the English and the Arabic label for one field', async () => {
    const headers = [...HEADER_ROW];
    headers[4] = 'الاجمالي';
    headers[3] = 'Total';
    const buffer = await buildWorkbook([transactionRow()], { headers });

    await expect(parseMasRevenueWorkbook(buffer)).rejects.toThrow(/ambiguous/);
  });

  it('refuses bytes that are not an xlsx workbook', async () => {
    await expect(
      parseMasRevenueWorkbook(Buffer.from('not a workbook')),
    ).rejects.toThrow(MasRevenueError);
  });
});
