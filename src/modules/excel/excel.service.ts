import { Injectable } from '@nestjs/common';

import { IExcelAdapter } from '@/modules/excel/interfaces/excel-adapter.interface';

@Injectable()
export class ExcelService {
  constructor(private readonly adapter: IExcelAdapter) {}

  excelToJson<T>(buffer: Buffer): Promise<T[]> {
    return this.adapter.read<T>(buffer);
  }

  jsonToExcel<T extends object>(data: T[]): Promise<Buffer> {
    return this.adapter.write<T>(data);
  }
}
