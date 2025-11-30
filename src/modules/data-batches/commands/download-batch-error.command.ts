import { ICommand } from '@nestjs/cqrs';

export class DownloadBatchErrorCommand implements ICommand {
  batchId: string;
}

