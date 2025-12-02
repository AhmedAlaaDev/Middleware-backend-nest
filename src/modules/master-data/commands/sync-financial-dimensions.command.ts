import { Command } from '@nestjs/cqrs';

export class SyncFinancialDimensionsCommand extends Command<{
  dimensionsCreated: number;
  dimensionValuesCreated: number;
}> {
  constructor(public readonly company?: string) {
    super();
  }
}

