import { Command } from '@nestjs/cqrs';

export class DownloadBatchErrorCommand extends Command<Buffer> {
  constructor(public readonly batchId: string) {
    super();
  }
}
