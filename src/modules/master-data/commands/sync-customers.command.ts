import { Command } from '@nestjs/cqrs';

export class SyncCustomersCommand extends Command<{
  customersCreated: number;
  customersUpdated: number;
}> {
  constructor(public readonly company: string) {
    super();
  }
}

