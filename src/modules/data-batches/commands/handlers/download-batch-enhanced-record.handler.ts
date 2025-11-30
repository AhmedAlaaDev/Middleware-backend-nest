import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { DownloadBatchEnhancedRecordCommand } from '../download-batch-enhanced-record.command';
import { DataBatchService } from '../../services/data-batch.service';
import { OperationResultDto } from '../../../../common/dto/operation-result.dto';
import * as ExcelJS from 'exceljs';
import { join } from 'path';
import { writeFileSync, unlinkSync } from 'fs';

@CommandHandler(DownloadBatchEnhancedRecordCommand)
export class DownloadBatchEnhancedRecordHandler
  implements ICommandHandler<DownloadBatchEnhancedRecordCommand>
{
  constructor(private readonly batchService: DataBatchService) {}

  async execute(
    command: DownloadBatchEnhancedRecordCommand,
  ): Promise<OperationResultDto<string>> {
    const enhancedRecords = await this.batchService.getEnhancedRecordsAsync(
      command.batchId,
    );

    if (enhancedRecords.length === 0) {
      return OperationResultDto.failure(
        'No enhanced records found for this batch',
        404,
      );
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

    return OperationResultDto.success(filePath);
  }
}

