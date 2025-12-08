import { Command } from '@nestjs/cqrs';

export class DownloadBatchEnhancedRecordCommand extends Command<Buffer> {
  constructor(public readonly batchId: string) {
    super();
  }
}
