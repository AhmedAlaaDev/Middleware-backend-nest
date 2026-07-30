export interface ExcelSheetData<T> {
  headers: string[];
  rows: T[];
}

export abstract class IExcelAdapter {
  abstract read<T = any>(buffer: Buffer): Promise<T[]>;
  abstract readSheet<T = any>(buffer: Buffer): Promise<ExcelSheetData<T>>;
  abstract write<T extends object = { [key: string]: any }>(
    data: T[],
  ): Promise<Buffer>;
  abstract writeStream<T extends object = { [key: string]: any }>(
    dataStream: AsyncIterable<T>,
    filePath: string,
    headers?: string[],
  ): Promise<void>;
}
