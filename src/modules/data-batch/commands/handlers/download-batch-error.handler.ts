import { Logger, NotFoundException } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { DownloadBatchErrorCommand } from '@/modules/data-batch/commands/download-batch-error.command';
import { IDataBatchError } from '@/modules/data-batch/interfaces/data-batch-error.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ExcelService } from '@/modules/excel/excel.service';
import {
  isCustodySettlementSkipError,
  toCustodySettlementSkipExcelRow,
} from '@/modules/cash/services/custody-settlement-skip-report';

@CommandHandler(DownloadBatchErrorCommand)
export class DownloadBatchErrorHandler implements ICommandHandler<DownloadBatchErrorCommand> {
  private readonly logger = new Logger(DownloadBatchErrorHandler.name);

  constructor(
    private readonly db: DataBatchService,
    private readonly excelService: ExcelService,
  ) {}

  public async execute(command: DownloadBatchErrorCommand): Promise<string> {
    const { batchId } = command;

    this.logger.log(`Downloading errors for batch ${batchId}`);

    const cursor = await this.db.getErrorsStream(batchId);
    const errorsStream = this.cursorToAsyncIterable(cursor);

    // First pass: check if there are any errors
    let hasErrors = false;
    let errorCount = 0;
    for await (const _error of errorsStream) {
      hasErrors = true;
      errorCount++;
      if (errorCount === 1) break; // Just need to know if at least one exists
    }

    if (!hasErrors) {
      throw new NotFoundException('No errors found for this batch');
    }

    // Second pass: stream all errors to Excel
    const cursor2 = await this.db.getErrorsStream(batchId);
    const errorsStream2 = this.cursorToAsyncIterable(cursor2);
    const rowsStream = this.transformErrorsToRows(errorsStream2);

    // Pre-define headers for Excel. Custody Settlement skip rows add source
    // UniqueId / Excel LINENUMBER / phase so failed upload and settlement
    // lines can be mapped back to the source workbook.
    const headers = [
      'UniqueId',
      'Excel LINENUMBER',
      'JournalBatchNumber',
      'D365 LineNumber',
      'VendorAccount',
      'InvoiceNumber',
      'DocumentNumber',
      'Amount',
      'Phase',
      'Error',
      'Source Record IDs',
      'Enhanced Record IDs',
      'Error Messages',
      'Dimension Model',
    ];

    const filePath = await this.excelService.writeObjectsToTempFileStream(
      rowsStream,
      `batch-${batchId}-errors`,
      headers,
    );

    this.logger.log('Excel file for errors generated successfully.');
    return filePath;
  }

  /**
   * Converts MongoDB cursor to async iterable for errors
   */
  private async *cursorToAsyncIterable(
    cursor: any,
  ): AsyncIterable<IDataBatchError> {
    try {
      for await (const doc of cursor) {
        yield {
          id: doc._id.toString(),
          batchId: doc.batchId,
          sourceRecordIds: doc.sourceRecordIds || [],
          errorMessages: doc.errorMessages || [],
          accountDimensionsModel: doc.accountDimensionsModel,
          enhancedRecordIds: doc.enhancedRecordIds || [],
          enhancedData: doc.enhancedData,
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
   * Transforms error records to Excel rows
   */
  private async *transformErrorsToRows(
    errorsStream: AsyncIterable<IDataBatchError>,
  ): AsyncIterable<Record<string, string>> {
    for await (const error of errorsStream) {
      await Promise.resolve(); // Satisfy async generator requirement
      const enhancedData = error.enhancedData as
        | Record<string, unknown>
        | undefined;
      const skip = isCustodySettlementSkipError(enhancedData)
        ? toCustodySettlementSkipExcelRow(enhancedData)
        : undefined;
      yield {
        UniqueId:
          skip?.UniqueId || error.sourceRecordIds?.join(', ') || '',
        'Excel LINENUMBER': skip?.['Excel LINENUMBER'] || '',
        JournalBatchNumber: skip?.JournalBatchNumber || '',
        'D365 LineNumber': skip?.['D365 LineNumber'] || '',
        VendorAccount: skip?.VendorAccount || '',
        InvoiceNumber: skip?.InvoiceNumber || '',
        DocumentNumber: skip?.DocumentNumber || '',
        Amount: skip?.Amount || '',
        Phase: skip?.Phase || '',
        Error: skip?.Error || error.errorMessages?.join('; ') || '',
        'Source Record IDs': error.sourceRecordIds?.join(', ') || '',
        'Enhanced Record IDs': error.enhancedRecordIds?.join(', ') || '',
        'Error Messages': error.errorMessages?.join('; ') || '',
        'Dimension Model': JSON.stringify(error.accountDimensionsModel || {}),
      };
    }
  }
}
