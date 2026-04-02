import { Command } from '@nestjs/cqrs';

import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';

export class ProcessVendorPaymentTruckingCommand extends Command<IDataBatch> {
  constructor(
    public readonly companyId: string,
    public readonly fileBuffer?: Buffer,
    public readonly rawData?: any[],
  ) {
    super();
  }
}
