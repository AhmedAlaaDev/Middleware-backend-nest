import { promises as fs } from 'fs';
import { join } from 'path';

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

  async writeObjectsToTempFile<T extends object>(
    data: T[],
    fileNamePrefix: string,
  ): Promise<string> {
    const buffer = await this.jsonToExcel<T>(data);
    const dir = join(process.cwd(), 'temp');
    await fs.mkdir(dir, { recursive: true });
    const filePath = join(dir, `${fileNamePrefix}-${Date.now()}.xlsx`);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }
}
