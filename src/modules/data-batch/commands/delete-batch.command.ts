import { Command } from '@nestjs/cqrs';

export class DeleteBatchCommand extends Command<void> {
  constructor(
    public readonly batchId: string,
    public readonly actor: {
      id: string;
      name: string;
      email: string;
    },
  ) {
    super();
  }
}
