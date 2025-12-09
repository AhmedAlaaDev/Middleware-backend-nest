import { Command } from '@nestjs/cqrs';

export interface DownloadBatchEnhancedRecordResult {
  buffer: Buffer;
  isZip: boolean;
}

export class DownloadBatchEnhancedRecordCommand extends Command<DownloadBatchEnhancedRecordResult> {
  constructor(public readonly batchId: string) {
    super();
  }
}
