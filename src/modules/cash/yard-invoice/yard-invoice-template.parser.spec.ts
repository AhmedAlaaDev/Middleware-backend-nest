import { readFileSync } from 'fs';
import { join } from 'path';

import ExcelJS from 'exceljs';

import {
  parseYardInvoiceTemplate,
  YardInvoiceTemplateError,
} from './yard-invoice-template.parser';
import { YARD_INVOICE_TEMPLATE_HEADERS } from './yard-invoice.constants';
import {
  baseRow,
  buildTemplateWorkbook,
  buildZip,
} from './yard-invoice.test-helpers';

const REAL_TEMPLATE = join(
  __dirname,
  'fixtures',
  'Yards-Shiplink-Template.xlsx',
);

describe('parseYardInvoiceTemplate', () => {
  it('accepts the supplied 8-column template with no data rows', async () => {
    const result = await parseYardInvoiceTemplate(readFileSync(REAL_TEMPLATE));
    expect(result.sheetName).toBe('Template');
    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.contentRowCount).toBe(0);
  });

  it('parses a valid row, keeping invoice text, leading zeros and suffixes', async () => {
    const buffer = await buildTemplateWorkbook([
      baseRow({ InvoiceNumber: '  000061156/YD  ' }),
    ]);
    const result = await parseYardInvoiceTemplate(buffer);
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(1);
    const [row] = result.rows;
    expect(row.invoiceNumber).toBe('000061156/YD');
    expect(row.paymentDate).toBe('2026-07-15');
    expect(row.paymentType).toBe('Cash');
    expect(row.currencyCode).toBe('EGP');
    expect(row.amountText).toBe('1350.0001');
    expect(row.amount).toBe(1350000100n);
    expect(row.sourceRow).toBe(2);
  });

  it('accepts Excel date cells and ISO text dates', async () => {
    const buffer = await buildTemplateWorkbook([
      baseRow({ PaymentDate: new Date(Date.UTC(2026, 6, 1)) }),
      baseRow({ PaymentDate: '2026-07-02', PaymentSerial: 'PS-2' }),
    ]);
    const result = await parseYardInvoiceTemplate(buffer);
    expect(result.issues).toEqual([]);
    expect(result.rows.map((r) => r.paymentDate)).toEqual([
      '2026-07-01',
      '2026-07-02',
    ]);
  });

  it('rejects impossible or ambiguous dates', async () => {
    const buffer = await buildTemplateWorkbook([
      baseRow({ PaymentDate: '31-02-2026' }),
      baseRow({ PaymentDate: '7/15/2026', PaymentSerial: 'PS-2' }),
    ]);
    const result = await parseYardInvoiceTemplate(buffer);
    expect(result.rows).toEqual([]);
    expect(result.issues.map((i) => i.column)).toEqual([
      'PaymentDate',
      'PaymentDate',
    ]);
  });

  it('rejects unknown payment types instead of defaulting them', async () => {
    const buffer = await buildTemplateWorkbook([
      baseRow({ 'Payment Type': 'Visa' }),
    ]);
    const result = await parseYardInvoiceTemplate(buffer);
    expect(result.issues[0]).toMatchObject({
      column: 'Payment Type',
      sourceRow: 2,
    });
  });

  it('maps only the accepted payment-type spellings', async () => {
    const buffer = await buildTemplateWorkbook([
      baseRow({ 'Payment Type': 'CASH' }),
      baseRow({ 'Payment Type': 'check', PaymentSerial: 'PS-2' }),
      baseRow({ 'Payment Type': 'transfer', PaymentSerial: 'PS-3' }),
    ]);
    const result = await parseYardInvoiceTemplate(buffer);
    expect(result.issues).toEqual([]);
    expect(result.rows.map((r) => r.paymentType)).toEqual([
      'Cash',
      'Cheque',
      'Transfer',
    ]);
  });

  it('rejects zero, negative and over-precise amounts', async () => {
    const buffer = await buildTemplateWorkbook([
      baseRow({ 'PaymentNet Total': '-1420' }),
      baseRow({ 'PaymentNet Total': '0', PaymentSerial: 'PS-2' }),
      baseRow({ 'PaymentNet Total': '1.0000001', PaymentSerial: 'PS-3' }),
      baseRow({ 'PaymentNet Total': 'abc', PaymentSerial: 'PS-4' }),
    ]);
    const result = await parseYardInvoiceTemplate(buffer);
    expect(result.rows).toEqual([]);
    expect(result.issues.map((i) => i.column)).toEqual([
      'PaymentNet Total',
      'PaymentNet Total',
      'PaymentNet Total',
      'PaymentNet Total',
    ]);
  });

  it('rejects credit-note (-CN) invoices', async () => {
    const buffer = await buildTemplateWorkbook([
      baseRow({ InvoiceNumber: '000000375/YD-CN' }),
    ]);
    const result = await parseYardInvoiceTemplate(buffer);
    expect(result.issues[0]).toMatchObject({ column: 'InvoiceNumber' });
    expect(result.issues[0].message).toMatch(/credit-note/);
  });

  it('rejects numeric invoice numbers because leading zeros would be lost', async () => {
    const buffer = await buildTemplateWorkbook([
      baseRow({ InvoiceNumber: 61156 }),
    ]);
    const result = await parseYardInvoiceTemplate(buffer);
    expect(result.issues[0]).toMatchObject({ column: 'InvoiceNumber' });
    expect(result.issues[0].message).toMatch(/text/);
  });

  it('rejects formulas in any template cell', async () => {
    const buffer = await buildTemplateWorkbook([
      baseRow({ PaymentCurrency: 'EGP' }),
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    workbook.worksheets[0].getRow(2).getCell(5).value = {
      formula: '"EG"&"P"',
      result: 'EGP',
    };
    const rewritten = Buffer.from(
      (await workbook.xlsx.writeBuffer()) as ArrayBuffer,
    );
    const result = await parseYardInvoiceTemplate(rewritten);
    expect(
      result.issues.some(
        (i) => i.column === 'PaymentCurrency' && /formula/.test(i.message),
      ),
    ).toBe(true);
  });

  it('skips fully blank rows and flags partly blank rows', async () => {
    const buffer = await buildTemplateWorkbook([
      {
        PaymentSerial: '',
        PaymentDate: '',
        'Payment Type': '',
        'PaymentNet Total': '',
        PaymentCurrency: '',
        PaymentReference: '',
        SAFE_BankAccount: '',
        InvoiceNumber: '',
      },
      baseRow({ PaymentSerial: 'PS-9', InvoiceNumber: '' }),
    ]);
    const result = await parseYardInvoiceTemplate(buffer);
    expect(result.contentRowCount).toBe(1);
    expect(result.issues.some((i) => i.column === 'InvoiceNumber')).toBe(true);
  });

  it('rejects a wrong sheet name', async () => {
    const buffer = await buildTemplateWorkbook([baseRow()], {
      sheetName: 'Sheet1',
    });
    await expect(parseYardInvoiceTemplate(buffer)).rejects.toThrow(
      YardInvoiceTemplateError,
    );
  });

  it('rejects extra sheets', async () => {
    const buffer = await buildTemplateWorkbook([baseRow()], {
      extraSheets: ['Notes'],
    });
    await expect(parseYardInvoiceTemplate(buffer)).rejects.toThrow(
      /exactly one sheet/,
    );
  });

  it('rejects missing, reordered or duplicate headers', async () => {
    const missing = await buildTemplateWorkbook([baseRow()], {
      headers: YARD_INVOICE_TEMPLATE_HEADERS.slice(0, 7),
    });
    await expect(parseYardInvoiceTemplate(missing)).rejects.toThrow(
      /headers must be exactly/,
    );

    const reordered = await buildTemplateWorkbook([baseRow()], {
      headers: [...YARD_INVOICE_TEMPLATE_HEADERS].reverse(),
    });
    await expect(parseYardInvoiceTemplate(reordered)).rejects.toThrow(
      /headers must be exactly/,
    );

    const duplicate = await buildTemplateWorkbook([baseRow()], {
      headers: [...YARD_INVOICE_TEMPLATE_HEADERS.slice(0, 7), 'PaymentSerial'],
    });
    await expect(parseYardInvoiceTemplate(duplicate)).rejects.toThrow(
      /headers must be exactly/,
    );
  });

  it('rejects files that are not xlsx packages', async () => {
    await expect(
      parseYardInvoiceTemplate(Buffer.from('not a workbook')),
    ).rejects.toThrow(YardInvoiceTemplateError);
  });

  it('rejects a workbook that carries a VBA macro project', async () => {
    const xlsx = await buildTemplateWorkbook([baseRow()]);
    const zipped = await buildZip([
      { name: 'xl/vbaProject.bin', content: Buffer.from('macro') },
      { name: 'xl/workbook.xml', content: xlsx },
    ]);
    await expect(parseYardInvoiceTemplate(zipped)).rejects.toThrow(
      /disallowed entry/,
    );
  });

  it('rejects a row count above the limit', async () => {
    const rows = Array.from({ length: 2001 }, (_, i) =>
      baseRow({ PaymentSerial: `PS-${i}`, InvoiceNumber: `INV-${i}` }),
    );
    const buffer = await buildTemplateWorkbook(rows);
    await expect(parseYardInvoiceTemplate(buffer)).rejects.toThrow(/row limit/);
  });
});
