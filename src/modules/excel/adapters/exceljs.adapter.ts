import { Workbook } from 'exceljs';

import { IExcelAdapter } from '@/modules/excel/interfaces/excel-adapter.interface';

export class ExcelJsAdapter extends IExcelAdapter {
  public async read<T = any>(buffer: Buffer): Promise<T[]> {
    const workbook = new Workbook();
    const ab = new Uint8Array(buffer).buffer;
    await workbook.xlsx.load(ab);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];
    const headerRow = worksheet.getRow(1).values as any[];
    const headers = headerRow.slice(1) as string[];
    const rows: T[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const rowValues = row.values as any[];
      const obj: any = {};
      headers.forEach((header, idx) => {
        obj[header] = rowValues[idx + 1];
      });
      rows.push(obj as T);
    });

    return rows;
  }

  public async write<T extends object = { [key: string]: any }>(
    data: T[],
  ): Promise<Buffer> {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');
    if (data.length === 0) {
      return Buffer.from([]);
    }
    const headers = Object.keys(data[0]);
    worksheet.addRow(headers);
    data.forEach((item) => {
      worksheet.addRow(headers.map((h) => (item as any)[h]));
    });
    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf);
  }
}
