import { createWriteStream } from 'fs';

import { BadRequestException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import * as Excel from 'exceljs';

import {
  ExcelSheetData,
  IExcelAdapter,
} from '@/modules/excel/interfaces/excel-adapter.interface';

export class ExcelJsAdapter extends IExcelAdapter {
  public async read<T = any>(buffer: Buffer): Promise<T[]> {
    return (await this.readSheet<T>(buffer)).rows;
  }

  public async readSheet<T = any>(buffer: Buffer): Promise<ExcelSheetData<T>> {
    if (!buffer?.length) {
      throw new BadRequestException('Excel file is empty or missing.');
    }

    const workbook = new Workbook();
    // Pass a copied Node Buffer. Using `new Uint8Array(buffer).buffer` can hand
    // ExcelJS a pooled ArrayBuffer larger than the file, which then fails inside
    // XLSX.load with "Cannot read properties of undefined (reading 'sheets')".
    try {
      await workbook.xlsx.load(
        Buffer.from(buffer) as unknown as Parameters<
          typeof workbook.xlsx.load
        >[0],
      );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'The uploaded file is not a valid readable Excel workbook (.xlsx).',
      );
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet) return { headers: [], rows: [] };
    const headerRow = worksheet.getRow(1).values as any[];
    const headers = headerRow
      .slice(1)
      .map((header) =>
        header == null || typeof header === 'object'
          ? ''
          : String(header).trim(),
      );
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

    return { headers, rows };
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

  public async writeStream<T extends object = { [key: string]: any }>(
    dataStream: AsyncIterable<T>,
    filePath: string,
    headers?: string[],
  ): Promise<void> {
    const output = createWriteStream(filePath);
    const workbook = new Excel.stream.xlsx.WorkbookWriter({
      stream: output,
    });
    const worksheet = workbook.addWorksheet('Sheet1');

    let isFirstRow = true;
    let detectedHeaders: string[] | undefined = headers;
    let columnKeys: string[] = [];

    for await (const item of dataStream) {
      if (isFirstRow) {
        if (!detectedHeaders) {
          detectedHeaders = Object.keys(item);
        }
        columnKeys = detectedHeaders;
        worksheet.columns = columnKeys.map((h) => ({
          header: h,
          key: h,
        }));
        // Note: worksheet.columns automatically creates the header row, so we don't need to add it manually
        isFirstRow = false;
      }

      // Add data row - ensure all column keys are present
      const rowData = columnKeys.reduce(
        (acc, key) => {
          acc[key] = (item as any)[key] ?? '';
          return acc;
        },
        {} as Record<string, any>,
      );
      const row = worksheet.addRow(rowData);
      row.commit();
    }

    await workbook.commit();
  }
}
