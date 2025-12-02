import { Command } from '@nestjs/cqrs';

export class DownloadBatchEnhancedRecordCommand extends Command<string> {
  constructor(public readonly batchId: string) {
    super();
  }
}
