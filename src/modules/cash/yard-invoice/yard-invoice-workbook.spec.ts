import ExcelJS from 'exceljs';

import { YardInvoiceTemplateError } from './yard-invoice-template.parser';
import { parseYardWorkbook } from './yard-invoice-workbook';
import {
  baseRow,
  buildTemplateWorkbook,
  buildYardsSourceWorkbook,
  yardsRow,
} from './yard-invoice.test-helpers';

describe('parseYardWorkbook: format detection', () => {
  it('detects the eight-column template and labels it explicitly', async () => {
    const buffer = await buildTemplateWorkbook([baseRow()]);
    const result = await parseYardWorkbook(buffer);
    expect(result.format).toBe('TEMPLATE_8');
    expect(result.formatLabel).toMatch(/eight-column template/);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      format: 'TEMPLATE_8',
      sourceSheet: 'Template',
      layoutId: 'TEMPLATE_8',
      sourceRow: 2,
      paymentSerial: 'PS-0001',
      workbookCustomerAccount: null,
    });
  });

  it('detects the Yards source workbook from its sheet layouts', async () => {
    const buffer = await buildYardsSourceWorkbook([
      {
        name: 'Atlantic',
        layoutId: 'YARDS_LAYOUT_CUR_SAFE',
        rows: [yardsRow({ FREETEXTNUMBER: '000061184/YD' })],
      },
    ]);
    const result = await parseYardWorkbook(buffer);
    expect(result.format).toBe('YARDS_SOURCE');
    expect(result.formatLabel).toMatch(/Yards source workbook/);
    expect(result.sheets).toEqual([
      expect.objectContaining({
        sourceSheet: 'Atlantic',
        layoutId: 'YARDS_LAYOUT_CUR_SAFE',
        acceptedRecords: 1,
      }),
    ]);
  });

  it('refuses a workbook with a sheet that matches no layout, and lists the accepted formats', async () => {
    const buffer = await buildYardsSourceWorkbook([
      {
        name: 'Atlantic',
        layoutId: 'YARDS_LAYOUT_CUR_SAFE',
        rows: [yardsRow()],
      },
      { name: 'Notes', layoutId: 'YARDS_LAYOUT_CUR_SAFE', rows: [] },
    ]);
    // Replace the second sheet's header with an unknown one.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    wb.getWorksheet('Notes')!.getRow(1).getCell(1).value = 'Something Else';
    const rewritten = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    await expect(parseYardWorkbook(rewritten)).rejects.toThrow(
      /Accepted formats: \(1\)[\s\S]*Sheet\(s\) not recognised: "Notes"/,
    );
  });

  it('refuses a template-like workbook with an extra sheet', async () => {
    const buffer = await buildTemplateWorkbook([baseRow()], {
      extraSheets: ['Notes'],
    });
    await expect(parseYardWorkbook(buffer)).rejects.toThrow(
      YardInvoiceTemplateError,
    );
  });

  it('refuses a file that is not a workbook', async () => {
    await expect(parseYardWorkbook(Buffer.from('plain text'))).rejects.toThrow(
      YardInvoiceTemplateError,
    );
  });
});

describe('parseYardWorkbook: Yards source records', () => {
  it('maps every layout to the common model with sheet and row lineage', async () => {
    const buffer = await buildYardsSourceWorkbook([
      {
        name: '10-YARD-IST',
        layoutId: 'YARDS_LAYOUT_IST',
        rows: [
          yardsRow({
            'Payment Type': 'CASH',
            'Net Total': 1420,
            Currency: 'EGP       ',
            Customer: 'Synthetic Customer A',
            FREETEXTNUMBER: '000000375/YD',
          }),
        ],
      },
      {
        name: 'Atlantic',
        layoutId: 'YARDS_LAYOUT_CUR_SAFE',
        rows: [
          yardsRow({
            'Payment Type': 'CASH',
            'Net Total': 1370,
            Cur: 'EGP       ',
            safe: 'AtlanticEG',
            FREETEXTNUMBER: '000061184/YD',
          }),
        ],
      },
      {
        name: 'yard.',
        layoutId: 'YARDS_LAYOUT_REMARK',
        rows: [
          yardsRow({
            'Payment Type': 'transfer',
            'Net Total': 2000.5,
            Cur: 'USD       ',
            SAFE: 'QNB-US-CA2',
            'Payment Rmrk': 'qnb ref VA1',
            FREETEXTNUMBER: '000065988/YD',
          }),
        ],
      },
    ]);
    const result = await parseYardWorkbook(buffer);
    expect(result.format).toBe('YARDS_SOURCE');
    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(3);

    const ist = result.records[0];
    expect(ist).toMatchObject({
      format: 'YARDS_SOURCE',
      sourceSheet: '10-YARD-IST',
      layoutId: 'YARDS_LAYOUT_IST',
      sourceRow: 2,
      paymentSerial: null,
      paymentDate: '2026-07-15',
      paymentType: 'Cash',
      rawPaymentType: 'CASH',
      currencyCode: 'EGP',
      safeBankAccount: 'Yard Safe',
      invoiceNumber: '000000375/YD',
      workbookCustomerName: 'Synthetic Customer A',
      workbookCustomerAccount: '101000262',
      isCreditNote: false,
    });
    expect(ist.amountText).toBe('1420');
    expect(ist.workbookDimension).toMatch(/^\|2401\|024/);
    expect(ist.workbookFinTag).toMatch(/^\|\|MSC LINE/);

    expect(result.records[1]).toMatchObject({
      sourceSheet: 'Atlantic',
      layoutId: 'YARDS_LAYOUT_CUR_SAFE',
      sourceRow: 2,
      safeBankAccount: 'AtlanticEG',
      workbookCustomerName: null,
    });

    expect(result.records[2]).toMatchObject({
      sourceSheet: 'yard.',
      layoutId: 'YARDS_LAYOUT_REMARK',
      paymentType: 'Transfer',
      currencyCode: 'USD',
      paymentReference: 'qnb ref VA1',
      safeBankAccount: 'QNB-US-CA2',
    });
    expect(result.records[2].amount).toBe(2000500000n);
  });

  it('keeps the exact four-decimal amount and sums nothing itself', async () => {
    const buffer = await buildYardsSourceWorkbook([
      {
        name: 'Eagle',
        layoutId: 'YARDS_LAYOUT_CUR_SAFE',
        rows: [yardsRow({ 'Net Total': 1350.0001 })],
      },
    ]);
    const [record] = (await parseYardWorkbook(buffer)).records;
    expect(record.amount).toBe(1350000100n);
    expect(record.amountText).toBe('1350.0001');
  });

  it('reports a credit note as a record flagged isCreditNote with a negative exact amount', async () => {
    const buffer = await buildYardsSourceWorkbook([
      {
        name: 'Eagle',
        layoutId: 'YARDS_LAYOUT_CUR_SAFE',
        rows: [
          yardsRow({ FREETEXTNUMBER: '000000356/YD-CN', 'Net Total': -2740 }),
        ],
      },
    ]);
    const result = await parseYardWorkbook(buffer);
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({
      isCreditNote: true,
      amount: -2740000000n,
    });
  });

  it('rejects a negative amount on an invoice without the -CN suffix', async () => {
    const buffer = await buildYardsSourceWorkbook([
      {
        name: 'Eagle',
        layoutId: 'YARDS_LAYOUT_CUR_SAFE',
        rows: [yardsRow({ 'Net Total': -10 })],
      },
    ]);
    const result = await parseYardWorkbook(buffer);
    expect(result.records).toEqual([]);
    expect(result.issues[0]).toMatchObject({
      sourceSheet: 'Eagle',
      sourceRow: 2,
      column: 'Net Total',
    });
  });

  it('rejects a payment remark longer than the D365 payment reference limit, without truncating it', async () => {
    const remark =
      'qnb transfer ref: VA332016691 total amount 2,000 for the yard invoices';
    const buffer = await buildYardsSourceWorkbook([
      {
        name: 'yard.',
        layoutId: 'YARDS_LAYOUT_REMARK',
        rows: [
          yardsRow({
            'Payment Type': 'transfer',
            SAFE: 'QNB-EG-CA1',
            'Payment Rmrk': remark,
          }),
        ],
      },
    ]);
    const result = await parseYardWorkbook(buffer);
    expect(result.records).toEqual([]);
    expect(result.issues[0]).toMatchObject({ column: 'Payment Rmrk' });
    expect(result.issues[0].message).toMatch(/not truncated/);
  });

  it('rejects a blank SAFE value', async () => {
    const buffer = await buildYardsSourceWorkbook([
      {
        name: 'yard.',
        layoutId: 'YARDS_LAYOUT_REMARK',
        rows: [yardsRow({ 'Payment Type': 'CHECK', SAFE: '' })],
      },
    ]);
    const result = await parseYardWorkbook(buffer);
    expect(result.records).toEqual([]);
    expect(result.issues.map((i) => i.column)).toContain('SAFE');
  });

  it('rejects an unsupported payment type and an invalid date', async () => {
    const buffer = await buildYardsSourceWorkbook([
      {
        name: 'Atlantic',
        layoutId: 'YARDS_LAYOUT_CUR_SAFE',
        rows: [
          yardsRow({ 'Payment Type': 'POS' }),
          yardsRow({
            'Payment Date': '31-02-2026',
            FREETEXTNUMBER: '000000002/YD',
          }),
        ],
      },
    ]);
    const result = await parseYardWorkbook(buffer);
    expect(result.records).toEqual([]);
    expect(result.issues.map((i) => i.column)).toEqual([
      'Payment Type',
      'Payment Date',
    ]);
  });

  it('skips blank rows and counts only rows with content', async () => {
    const buffer = await buildYardsSourceWorkbook([
      {
        name: 'Atlantic',
        layoutId: 'YARDS_LAYOUT_CUR_SAFE',
        rows: [
          yardsRow(),
          {
            'Payment Date': '',
            'Payment Type': '',
            'Net Total': '',
            Cur: '',
            safe: '',
            FREETEXTNUMBER: '',
            DEFAULTDIMENSIONDISPLAYVALUE: '',
            HEADERFINTAGDISPLAYVALUE: '',
            CUSTOMERACCOUNT: '',
          },
        ],
      },
    ]);
    const result = await parseYardWorkbook(buffer);
    expect(result.sheets[0]).toMatchObject({
      contentRows: 1,
      acceptedRecords: 1,
    });
  });
});
