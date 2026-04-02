import { Command } from '@nestjs/cqrs';

import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';

export class ProcessCashInTruckingCommand extends Command<IDataBatch> {
  constructor(
    public readonly fileBuffer: Buffer,
    public readonly companyId?: string,
  ) {
    super();
  }
}
