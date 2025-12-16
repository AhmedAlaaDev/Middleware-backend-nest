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

    const cursor = this.batchService.getEnhancedRecordsStream(batchId);

    // Convert cursor to async iterable and process records
    const recordsStream = this.cursorToAsyncIterable(cursor);

    // First pass: detect if headers exist and collect unique headers
    let hasHeader = false;
    const uniqueHeaderKeys = new Set<string>();
    const headerMap = new Map<string, Record<string, unknown>>();
    let recordCount = 0;

    // Process records to detect headers and collect unique ones
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
    }

    if (recordCount === 0) {
      throw new NotFoundException('No enhanced records found for this batch');
    }

    this.logger.log(
      `Fetched ${recordCount} enhanced record(s) for batch ${batchId}`,
    );

    if (!hasHeader) {
      this.logger.log('No headers detected → generating single Excel file.');
      // Stream all records to single Excel file
      const cursor2 = this.batchService.getEnhancedRecordsStream(batchId);
      const recordsStream2 = this.cursorToAsyncIterable(cursor2);
      const dataStream = this.extractDataStream(recordsStream2, false);
      const excelPath = await this.excelService.writeObjectsToTempFileStream(
        dataStream,
        `batch-${batchId}-lines`,
      );
      this.logger.log('Excel file generated successfully.');
      return { filePath: excelPath, isZip: false };
    }

    this.logger.log('Headers detected → splitting header + data…');

    const uniqueHeaders = Array.from(headerMap.values());
    this.logger.log(`Collected ${uniqueHeaderKeys.size} unique header(s)`);

    this.logger.log('Generating Excel sheets…');

    // Stream headers to Excel file
    const headersStream = this.arrayToAsyncIterable(uniqueHeaders);
    const headersPath = await this.excelService.writeObjectsToTempFileStream(
      headersStream,
      `batch-${batchId}-headers`,
    );

    // Stream data (without headers) to Excel file
    const cursor3 = this.batchService.getEnhancedRecordsStream(batchId);
    const recordsStream3 = this.cursorToAsyncIterable(cursor3);
    const dataStream = this.extractDataStream(recordsStream3, true);
    const linesPath = await this.excelService.writeObjectsToTempFileStream(
      dataStream,
      `batch-${batchId}-lines`,
    );

    this.logger.log('Building ZIP (streaming)…');
    const zipPath = await this.excelService.createZipFile(batchId, [
      { filePath: headersPath, nameInZip: 'headers.xlsx' },
      { filePath: linesPath, nameInZip: 'lines.xlsx' },
    ]);

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
   * Extracts data from records, optionally removing header property
   */
  private async *extractDataStream(
    recordsStream: AsyncIterable<IDataEnhancedRecord>,
    removeHeader: boolean,
  ): AsyncIterable<Record<string, unknown>> {
    for await (const record of recordsStream) {
      const data = record.data;
      if (
        removeHeader &&
        data &&
        typeof data === 'object' &&
        'header' in data &&
        data.header
      ) {
        const { header, ...rest } = data;
        yield rest;
      } else {
        yield data;
      }
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
