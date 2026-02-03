import { Logger, NotFoundException } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { DownloadBatchSourceRecordCommand } from '@/modules/data-batch/commands/download-batch-source-record.command';
import { IDataSourceRecord } from '@/modules/data-batch/interfaces/data-source-record.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(DownloadBatchSourceRecordCommand)
export class DownloadBatchSourceRecordHandler implements ICommandHandler<DownloadBatchSourceRecordCommand> {
  private readonly logger = new Logger(DownloadBatchSourceRecordHandler.name);

  constructor(
    private readonly batchService: DataBatchService,
    private readonly excelService: ExcelService,
  ) {}

  public async execute(
    command: DownloadBatchSourceRecordCommand,
  ): Promise<string> {
    const { batchId } = command;

    this.logger.log(`Downloading source records for batch ${batchId}`);

    const cursor = this.batchService.getSourceRecordsStream(batchId);
    const recordsStream = this.cursorToAsyncIterable(cursor);

    // First pass: collect header names (union of all keys in record.data)
    const headerSet = new Set<string>();
    let recordCount = 0;
    try {
      for await (const record of recordsStream) {
        recordCount++;
        const data = record.data;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          for (const key of Object.keys(data)) {
            headerSet.add(key);
          }
        }
      }
    } finally {
      if (cursor && typeof cursor.close === 'function') {
        await cursor.close().catch(() => {});
      }
    }

    if (recordCount === 0) {
      throw new NotFoundException('No source records found for this batch');
    }

    const headers = Array.from(headerSet).sort();
    this.logger.log(
      `Collected ${headers.length} column(s) from ${recordCount} source record(s)`,
    );

    // Second pass: stream rows to Excel
    const cursor2 = this.batchService.getSourceRecordsStream(batchId);
    const recordsStream2 = this.cursorToAsyncIterable(cursor2);
    const rowsStream = this.transformToRows(recordsStream2, headers);

    const filePath = await this.excelService.writeObjectsToTempFileStream(
      rowsStream,
      `batch-${batchId}-source-records`,
      headers,
    );

    this.logger.log('Excel file for source records generated successfully.');
    return filePath;
  }

  /**
   * Converts MongoDB cursor to async iterable for source records
   */
  private async *cursorToAsyncIterable(
    cursor: any,
  ): AsyncIterable<IDataSourceRecord> {
    try {
      for await (const doc of cursor) {
        yield {
          id: doc._id.toString(),
          batchId: doc.batchId,
          data: doc.data,
        };
      }
    } finally {
      if (cursor && typeof cursor.close === 'function') {
        await cursor.close().catch(() => {});
      }
    }
  }

  /**
   * Transforms source records to flat rows for Excel (one row per record, columns = headers)
   */
  private async *transformToRows(
    recordsStream: AsyncIterable<IDataSourceRecord>,
    headers: string[],
  ): AsyncIterable<Record<string, string | number>> {
    for await (const record of recordsStream) {
      const data =
        record.data && typeof record.data === 'object' ? record.data : {};
      const row: Record<string, string | number> = {};
      for (const key of headers) {
        const value = data[key];
        if (value === null || value === undefined) {
          row[key] = '';
        } else if (typeof value === 'object') {
          row[key] = JSON.stringify(value);
        } else {
          row[key] = value as string | number;
        }
      }
      yield row;
    }
  }
}
