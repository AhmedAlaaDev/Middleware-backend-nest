import { Workbook } from 'exceljs';

import { ExcelJsAdapter } from './exceljs.adapter';

describe('ExcelJsAdapter', () => {
  it('skips a blank first worksheet and reads the first sheet with headers', async () => {
    const workbook = new Workbook();
    workbook.addWorksheet('Sheet2').getCell('C3').value = 'Values';
    const dataSheet = workbook.addWorksheet('Sheet1');
    dataSheet.addRow(['UniqueId', 'SafeType']);
    dataSheet.addRow([1, 'Vendor Payment']);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await new ExcelJsAdapter().readSheet(buffer);

    expect(result.headers).toEqual(['UniqueId', 'SafeType']);
    expect(result.rows).toEqual([{ UniqueId: 1, SafeType: 'Vendor Payment' }]);
  });

  it('reads a named worksheet when sheetName is provided', async () => {
    const workbook = new Workbook();
    const first = workbook.addWorksheet('Summary');
    first.addRow(['Status', 'Count']);
    first.addRow(['Ready', 2]);
    const dataSheet = workbook.addWorksheet('Enhanced_source');
    dataSheet.addRow(['Invoice', 'DueDate']);
    dataSheet.addRow(['000009219/Inv-SH', '2026-01-31']);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await new ExcelJsAdapter().readSheet(
      buffer,
      'Enhanced_source',
    );

    expect(result.headers).toEqual(['Invoice', 'DueDate']);
    expect(result.rows).toEqual([
      { Invoice: '000009219/Inv-SH', DueDate: '2026-01-31' },
    ]);
  });
});
