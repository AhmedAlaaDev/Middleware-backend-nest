import { NotFoundException } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { DownloadBatchEnhancedRecordCommand } from '@/modules/data-batch/commands/download-batch-enhanced-record.command';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(DownloadBatchEnhancedRecordCommand)
export class DownloadBatchEnhancedRecordHandler implements ICommandHandler<DownloadBatchEnhancedRecordCommand> {
  constructor(
    private readonly batchService: DataBatchService,
    private readonly excelService: ExcelService,
  ) {}

  public async execute(
    command: DownloadBatchEnhancedRecordCommand,
  ): Promise<string> {
    const { batchId } = command;

    const enhancedRecords =
      await this.batchService.getEnhancedRecordsAsync(batchId);

    if (enhancedRecords.length === 0) {
      throw new NotFoundException('No enhanced records found for this batch');
    }

    const data = enhancedRecords.map((r) => r.data);
    const filePath = await this.excelService.writeObjectsToTempFile(
      data,
      `enhanced-records-${command.batchId}`,
    );
    return filePath;
  }
}
