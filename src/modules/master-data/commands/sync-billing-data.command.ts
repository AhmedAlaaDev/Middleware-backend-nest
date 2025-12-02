import { Command } from '@nestjs/cqrs';

export class SyncBillingDataCommand extends Command<{
  classificationsCreated: number;
  classificationsUpdated: number;
  codesCreated: number;
  codesUpdated: number;
}> {
  constructor(public readonly company?: string) {
    super();
  }
}

