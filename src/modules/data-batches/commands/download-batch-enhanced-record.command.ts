import { ICommand } from '@nestjs/cqrs';

export class DownloadBatchEnhancedRecordCommand implements ICommand {
  batchId: string;
}

