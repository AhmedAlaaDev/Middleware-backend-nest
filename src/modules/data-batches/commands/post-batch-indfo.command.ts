import { ICommand } from '@nestjs/cqrs';

export class PostBatchInDFOCommand implements ICommand {
  batchId: string;
}

