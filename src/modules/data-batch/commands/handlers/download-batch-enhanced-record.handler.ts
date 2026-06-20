import { Logger, NotFoundException } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import {
  DownloadBatchEnhancedRecordCommand,
  DownloadBatchEnhancedRecordResult,
} from '@/modules/data-batch/commands/download-batch-enhanced-record.command';
import { IDataEnhancedRecord } from '@/modules/data-batch/interfaces/data-enhanced-record.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(DownloadBatchEnhancedRecordCommand)
export class DownloadBatchEnhancedRecordHandler implements ICommandHandler<
  DownloadBatchEnhancedRecordCommand,
  DownloadBatchEnhancedRecordResult
> {
  private readonly logger = new Logger(DownloadBatchEnhancedRecordHandler.name);

  constructor(
    private readonly batchService: DataBatchService,
    private readonly excelService: ExcelService,
  ) {}

  public async execute(
    command: DownloadBatchEnhancedRecordCommand,
  ): Promise<DownloadBatchEnhancedRecordResult> {
    const { batchId } = command;

    this.logger.log(`Downloading enhanced records for batch ${batchId}`);

    const cursor = await this.batchService.getEnhancedRecordsStream(batchId);

    // Convert cursor to async iterable and process records
    const recordsStream = this.cursorToAsyncIterable(cursor);

    // First pass: detect if headers exist and collect unique headers
    let hasHeader = false;
    let hasSettled = false;
    const uniqueHeaderKeys = new Set<string>();
    const headerMap = new Map<string, Record<string, unknown>>();
    let recordCount = 0;

    // Process records to detect header/settled and collect unique headers
    for await (const record of recordsStream) {
      recordCount++;
      const data = record.data;
      if (data && typeof data === 'object' && 'header' in data && data.header) {
        hasHeader = true;
        const header = data.header as Record<string, unknown>;
        const headerKey = JSON.stringify(header);
        if (!uniqueHeaderKeys.has(headerKey)) {
          uniqueHeaderKeys.add(headerKey);
          headerMap.set(headerKey, header);
        }
      }
      if (
        data &&
        typeof data === 'object' &&
        'settled' in data &&
        data.settled
      ) {
        hasSettled = true;
      }
    }

    if (recordCount === 0) {
      throw new NotFoundException('No enhanced records found for this batch');
    }

    this.logger.log(
      `Fetched ${recordCount} enhanced record(s) for batch ${batchId}`,
    );

    if (!hasHeader && !hasSettled) {
      this.logger.log(
        'No headers/settled detected → generating single Excel file.',
      );
      // Stream all records to single Excel file
      const cursor2 = await this.batchService.getEnhancedRecordsStream(batchId);
      const recordsStream2 = this.cursorToAsyncIterable(cursor2);
      const dataStream = this.extractDataStream(recordsStream2, {
        removeHeader: false,
        removeSettled: false,
      });
      const excelPath = await this.excelService.writeObjectsToTempFileStream(
        dataStream,
        `batch-${batchId}-lines`,
      );
      this.logger.log('Excel file generated successfully.');
      return { filePath: excelPath, isZip: false };
    }

    this.logger.log(
      `Nested objects detected (header=${hasHeader}, settled=${hasSettled}) → splitting…`,
    );

    const uniqueHeaders = Array.from(headerMap.values());
    if (hasHeader) {
      this.logger.log(`Collected ${uniqueHeaderKeys.size} unique header(s)`);
    }

    this.logger.log('Generating Excel sheets…');

    // Stream headers to Excel file (if present)
    let headersPath: string | null = null;
    if (hasHeader) {
      const headersStream = this.arrayToAsyncIterable(uniqueHeaders);
      headersPath = await this.excelService.writeObjectsToTempFileStream(
        headersStream,
        `batch-${batchId}-headers`,
      );
    }

    // Stream settled to Excel file (if present)
    let settledPath: string | null = null;
    if (hasSettled) {
      const cursorSettled =
        await this.batchService.getEnhancedRecordsStream(batchId);
      const recordsStreamSettled = this.cursorToAsyncIterable(cursorSettled);
      const settledStream = this.extractNestedStream(
        recordsStreamSettled,
        'settled',
      );
      settledPath = await this.excelService.writeObjectsToTempFileStream(
        settledStream,
        `batch-${batchId}-settled`,
      );
    }

    // Stream data (without header/settled) to Excel file
    const cursor3 = await this.batchService.getEnhancedRecordsStream(batchId);
    const recordsStream3 = this.cursorToAsyncIterable(cursor3);
    const dataStream = this.extractDataStream(recordsStream3, {
      removeHeader: true,
      removeSettled: true,
    });
    const linesPath = await this.excelService.writeObjectsToTempFileStream(
      dataStream,
      `batch-${batchId}-lines`,
    );

    this.logger.log('Building ZIP (streaming)…');
    const files: Array<{ filePath: string; nameInZip: string }> = [];
    if (headersPath) {
      files.push({ filePath: headersPath, nameInZip: 'headers.xlsx' });
    }
    if (settledPath) {
      files.push({ filePath: settledPath, nameInZip: 'settled.xlsx' });
    }
    files.push({ filePath: linesPath, nameInZip: 'lines.xlsx' });

    const zipPath = await this.excelService.createZipFile(batchId, files);

    this.logger.log('ZIP archive created successfully.');
    return { filePath: zipPath, isZip: true };
  }

  // ------------------------------------------
  // 🔹 Private Helpers
  // ------------------------------------------

  /**
   * Converts MongoDB cursor to async iterable
   */
  private async *cursorToAsyncIterable(
    cursor: any,
  ): AsyncIterable<IDataEnhancedRecord> {
    // Mongoose cursor is already an async iterable
    try {
      for await (const doc of cursor) {
        yield {
          id: doc._id.toString(),
          batchId: doc.batchId,
          dimensionModel: doc.dimensionModel,
          sourceIds: doc.sourceIds || [],
          data: doc.data,
          dataModelType: doc.dataModelType,
          validationRunId: doc.validationRunId,
        };
      }
    } finally {
      // Ensure cursor is closed
      if (cursor && typeof cursor.close === 'function') {
        await cursor.close().catch(() => {
          // Ignore errors on close
        });
      }
    }
  }

  /**
   * Extracts data from records, optionally removing nested properties
   */
  private async *extractDataStream(
    recordsStream: AsyncIterable<IDataEnhancedRecord>,
    opts: { removeHeader: boolean; removeSettled: boolean },
  ): AsyncIterable<Record<string, unknown>> {
    for await (const record of recordsStream) {
      const data = record.data;
      if (!data || typeof data !== 'object') {
        yield data as any;
        continue;
      }

      const obj = data;
      if (!opts.removeHeader && !opts.removeSettled) {
        yield obj;
        continue;
      }

      // Remove nested objects that we export separately
      const { header, settled, ...rest } = obj as any;

      const withoutHeader = opts.removeHeader ? rest : { header, ...rest };
      if (!opts.removeSettled) {
        yield { settled, ...withoutHeader } as Record<string, unknown>;
      } else {
        yield withoutHeader as Record<string, unknown>;
      }
    }
  }

  /**
   * Extracts a nested object stream (e.g. `settled`) from records.
   * Skips records where nested object is missing.
   */
  private async *extractNestedStream(
    recordsStream: AsyncIterable<IDataEnhancedRecord>,
    nestedKey: 'settled',
  ): AsyncIterable<Record<string, unknown>> {
    for await (const record of recordsStream) {
      const data = record.data;
      if (!data || typeof data !== 'object') continue;

      const nested = (data as any)?.[nestedKey];
      if (!nested || typeof nested !== 'object') continue;

      yield nested as Record<string, unknown>;
    }
  }

  /**
   * Converts array to async iterable
   */
  private async *arrayToAsyncIterable<T>(array: T[]): AsyncIterable<T> {
    for (const item of array) {
      await Promise.resolve(); // Satisfy async generator requirement
      yield item;
    }
  }
}
