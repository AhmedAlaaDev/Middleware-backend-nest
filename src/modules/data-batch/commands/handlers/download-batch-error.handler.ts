import { join } from 'path';

import { NotFoundException } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import * as ExcelJS from 'exceljs';

import { DownloadBatchErrorCommand } from '@/modules/data-batch/commands/download-batch-error.command';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';

@CommandHandler(DownloadBatchErrorCommand)
export class DownloadBatchErrorHandler implements ICommandHandler<DownloadBatchErrorCommand> {
  constructor(private readonly db: DataBatchService) {}

  public async execute(command: DownloadBatchErrorCommand): Promise<string> {
    const errors = await this.db.getErrorsAsync(command.batchId);

    if (errors.length === 0) {
      throw new NotFoundException('No errors found for this batch');
    }

    // Create Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Errors');

    // Add headers
    worksheet.addRow([
      'Source Record IDs',
      'Enhanced Record IDs',
      'Error Messages',
      'Dimension Model',
    ]);

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add error rows
    errors.forEach((error) => {
      worksheet.addRow([
        error.sourceRecordIds?.join(', ') || '',
        error.enhancedRecordIds?.join(', ') || '',
        error.errorMessages?.join('; ') || '',
        JSON.stringify(error.accountDimensionsModel || {}),
      ]);
    });

    // Save file
    const fileName = `batch-errors-${command.batchId}-${Date.now()}.xlsx`;
    const filePath = join(process.cwd(), 'temp', fileName);

    await workbook.xlsx.writeFile(filePath);

    return filePath;
  }
}
