import { Command } from '@nestjs/cqrs';

export class ReprocessBatchCommand extends Command<void> {
  constructor(
    public readonly batchId: string,
    public readonly missingDataId?: string,
  ) {
    super();
  }
}
