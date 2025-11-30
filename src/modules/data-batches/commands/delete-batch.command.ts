import { ICommand } from '@nestjs/cqrs';

export class DeleteBatchCommand implements ICommand {
  batchId: string;
}

