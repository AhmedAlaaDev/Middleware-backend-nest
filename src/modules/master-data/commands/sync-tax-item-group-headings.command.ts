import { Command } from '@nestjs/cqrs';

export class SyncTaxItemGroupHeadingsCommand extends Command<{
  created: number;
  updated: number;
}> {
  constructor(public readonly company: string) {
    super();
  }
}
