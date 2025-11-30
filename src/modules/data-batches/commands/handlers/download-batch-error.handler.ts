import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { DownloadBatchErrorCommand } from '../download-batch-error.command';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DataBatchError } from '../../schemas/data-batch-error.schema';
import { OperationResultDto } from '../../../../common/dto/operation-result.dto';
import * as ExcelJS from 'exceljs';
import { join } from 'path';

@CommandHandler(DownloadBatchErrorCommand)
export class DownloadBatchErrorHandler
  implements ICommandHandler<DownloadBatchErrorCommand>
{
  constructor(
    @InjectModel(DataBatchError.name)
    private readonly batchErrorModel: Model<DataBatchError>,
  ) {}

  async execute(
    command: DownloadBatchErrorCommand,
  ): Promise<OperationResultDto<string>> {
    const errors = await this.batchErrorModel
      .find({ batchId: command.batchId })
      .lean()
      .exec();

    if (errors.length === 0) {
      return OperationResultDto.failure(
        'No errors found for this batch',
        404,
      );
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

    return OperationResultDto.success(filePath);
  }
}

