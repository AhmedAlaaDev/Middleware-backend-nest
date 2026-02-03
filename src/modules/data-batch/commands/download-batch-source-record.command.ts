import { Command } from '@nestjs/cqrs';

export class DownloadBatchSourceRecordCommand extends Command<string> {
  constructor(public readonly batchId: string) {
    super();
  }
}
