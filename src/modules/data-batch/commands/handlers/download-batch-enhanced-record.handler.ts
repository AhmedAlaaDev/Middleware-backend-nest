import { join } from 'path';

import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import * as ExcelJS from 'exceljs';

import { DownloadBatchEnhancedRecordCommand } from '@/modules/data-batch/commands/download-batch-enhanced-record.command';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';

@CommandHandler(DownloadBatchEnhancedRecordCommand)
export class DownloadBatchEnhancedRecordHandler implements ICommandHandler<DownloadBatchEnhancedRecordCommand> {
  constructor(private readonly batchService: DataBatchService) {}

  public async execute(
    command: DownloadBatchEnhancedRecordCommand,
  ): Promise<string> {
    const { batchId } = command;

    const enhancedRecords =
      await this.batchService.getEnhancedRecordsAsync(batchId);

    if (enhancedRecords.length === 0) {
      throw new Error('No enhanced records found for this batch');
    }

    // Create Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Enhanced Records');

    // Add headers (assuming first record has all fields)
    if (enhancedRecords.length > 0) {
      const firstRecord = enhancedRecords[0].data;
      const headers = Object.keys(firstRecord);
      worksheet.addRow(headers);

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };

      // Add data rows
      enhancedRecords.forEach((record) => {
        const row = headers.map((header) => record.data[header] || '');
        worksheet.addRow(row);
      });

      // Auto-fit columns
      worksheet.columns.forEach((column) => {
        column.width = 15;
      });
    }

    // Save file
    const fileName = `enhanced-records-${command.batchId}-${Date.now()}.xlsx`;
    const filePath = join(process.cwd(), 'temp', fileName);

    await workbook.xlsx.writeFile(filePath);

    return filePath;
  }
}
