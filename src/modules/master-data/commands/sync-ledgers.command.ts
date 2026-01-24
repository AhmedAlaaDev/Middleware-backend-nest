import { Command } from '@nestjs/cqrs';

export class SyncLedgersCommand extends Command<{
  ledgersCreated: number;
  ledgersUpdated: number;
}> {
  constructor(public readonly company: string) {
    super();
  }
}
