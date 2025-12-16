import { promises as fs, createWriteStream } from 'fs';
import { join } from 'path';

import { Injectable } from '@nestjs/common';
import archiver from 'archiver';

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

  async writeObjectsToTempFileStream<T extends object>(
    dataStream: AsyncIterable<T>,
    fileNamePrefix: string,
    headers?: string[],
  ): Promise<string> {
    const dir = join(process.cwd(), 'temp');
    await fs.mkdir(dir, { recursive: true });
    const filePath = join(dir, `${fileNamePrefix}-${Date.now()}.xlsx`);
    await this.adapter.writeStream(dataStream, filePath, headers);
    return filePath;
  }

  public async createZipFile(
    batchId: string,
    files: { filePath: string; nameInZip: string }[],
  ): Promise<string> {
    const dir = join(process.cwd(), 'temp');
    await fs.mkdir(dir, { recursive: true });

    const zipPath = join(dir, `batch-${batchId}-${Date.now()}.zip`);
    const output = createWriteStream(zipPath);

    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      for (const f of files) {
        archive.file(f.filePath, { name: f.nameInZip });
      }

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      archive.finalize();
    });

    return zipPath;
  }
}
