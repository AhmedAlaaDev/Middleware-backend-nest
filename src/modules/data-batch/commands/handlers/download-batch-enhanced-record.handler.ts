import { Logger, NotFoundException } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import JSZip from 'jszip';

import {
  DownloadBatchEnhancedRecordCommand,
  DownloadBatchEnhancedRecordResult,
} from '@/modules/data-batch/commands/download-batch-enhanced-record.command';
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

    const enhancedRecords =
      await this.batchService.getEnhancedRecordsAsync(batchId);

    if (enhancedRecords.length === 0) {
      throw new NotFoundException('No enhanced records found for this batch');
    }

    this.logger.log(
      `Fetched ${enhancedRecords.length} enhanced record(s) for batch ${batchId}`,
    );

    const data = enhancedRecords.map((r) => r.data);
    const hasHeader = data.some(
      (record) => record && typeof record === 'object' && record.header,
    );

    if (!hasHeader) {
      this.logger.log('No headers detected → generating single Excel file.');
      const buffer = await this.excelService.jsonToExcel(data);
      this.logger.log('Excel file generated successfully.');
      return { buffer, isZip: false };
    }

    this.logger.log('Headers detected → splitting header + data…');

    // Extract headers
    const headers: any[] = [];
    const dataWithoutHeader = data.map((record) => {
      const { header, ...rest } = record;
      if (header) headers.push(header);
      return rest;
    });

    const uniqueHeaders = this.dedupe(headers);

    this.logger.log(
      `Collected ${headers.length}, deduped to ${uniqueHeaders.length}`,
    );

    this.logger.log('Generating Excel sheets…');
    const headerBuffer = await this.excelService.jsonToExcel(uniqueHeaders);
    const dataBuffer = await this.excelService.jsonToExcel(dataWithoutHeader);

    this.logger.log('Building ZIP archive…');
    const zipBuffer = await this.createZip({
      'headers.xlsx': headerBuffer,
      'lines.xlsx': dataBuffer,
    });

    this.logger.log('ZIP archive created successfully.');
    return { buffer: zipBuffer, isZip: true };
  }

  // ------------------------------------------
  // 🔹 Private Helpers
  // ------------------------------------------

  /**
   * Removes duplicate header objects (deep compare).
   */
  private dedupe(items: Record<string, unknown>[]): Record<string, unknown>[] {
    const seen = new Set<string>();
    const result: Record<string, unknown>[] = [];

    for (const item of items) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
    return result;
  }

  private async createZip(files: Record<string, Buffer>): Promise<Buffer> {
    const zip = new JSZip();

    for (const [filename, content] of Object.entries(files)) {
      zip.file(filename, content);
    }

    return await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
  }
}
