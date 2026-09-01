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
});
