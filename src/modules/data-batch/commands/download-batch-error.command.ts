import { Command } from '@nestjs/cqrs';

export class DownloadBatchErrorCommand extends Command<string> {
  constructor(public readonly batchId: string) {
    super();
  }
}
