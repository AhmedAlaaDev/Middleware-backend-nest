import { Command } from '@nestjs/cqrs';

export class SyncFinancialDimensionsCommand extends Command<{
  dimensionsCreated: number;
  dimensionsUpdated: number;
  dimensionValuesCreated: number;
  dimensionValuesUpdated: number;
}> {
  constructor(public readonly company?: string) {
    super();
  }
}

