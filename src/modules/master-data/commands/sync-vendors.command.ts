import { Command } from '@nestjs/cqrs';

export class SyncVendorsCommand extends Command<{
  vendorsCreated: number;
  vendorsUpdated: number;
}> {
  constructor(public readonly company: string) {
    super();
  }
}

