import { Command } from '@nestjs/cqrs';

export class AddDfoIdsCommand extends Command<void> {
  constructor(
    public readonly batchId: string,
    public readonly dfoIds: string[],
  ) {
    super();
  }
}
