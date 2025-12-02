import { Command } from '@nestjs/cqrs';

export class UpdateFinancialDimensionsCommand extends Command<{
  dimensionsUpdated: number;
  dimensionValuesUpdated: number;
}> {
  constructor(public readonly company?: string) {
    super();
  }
}

