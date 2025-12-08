import { NotFoundException } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { DownloadBatchErrorCommand } from '@/modules/data-batch/commands/download-batch-error.command';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(DownloadBatchErrorCommand)
export class DownloadBatchErrorHandler implements ICommandHandler<DownloadBatchErrorCommand> {
  constructor(
    private readonly db: DataBatchService,
    private readonly excelService: ExcelService,
  ) {}

  public async execute(command: DownloadBatchErrorCommand): Promise<Buffer> {
    const errors = await this.db.getErrorsAsync(command.batchId);

    if (errors.length === 0) {
      throw new NotFoundException('No errors found for this batch');
    }

    const rows = errors.map((error) => ({
      'Source Record IDs': error.sourceRecordIds?.join(', ') || '',
      'Enhanced Record IDs': error.enhancedRecordIds?.join(', ') || '',
      'Error Messages': error.errorMessages?.join('; ') || '',
      'Dimension Model': JSON.stringify(error.accountDimensionsModel || {}),
    }));
    const buffer = await this.excelService.jsonToExcel(rows);
    return buffer;
  }
}
