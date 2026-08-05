import { Command } from '@nestjs/cqrs';

import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';

export class ProcessCashOutFreightCommand extends Command<IDataBatch> {
  constructor(
    public readonly fileBuffer?: Buffer,
    public readonly companyId?: string,
    public readonly rawData?: any[],
  ) {
    super();
  }
}
