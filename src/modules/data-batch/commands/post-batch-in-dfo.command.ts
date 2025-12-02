import { Command } from '@nestjs/cqrs';

export class PostBatchInDFOCommand extends Command<void> {
  constructor(public readonly batchId: string) {
    super();
  }
}
