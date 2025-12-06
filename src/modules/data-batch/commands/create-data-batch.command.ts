import { Command } from '@nestjs/cqrs';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatch } from '@/modules/data-batch/schemas';

export class CreateDataBatchCommand extends Command<DataBatch> {
  constructor(
    public readonly entryProcessorType: EntryProcessorTypes,
    public readonly entryProcessorName: string,
    public readonly companyId: string,
    public readonly description: string,
    public readonly rawData: any[],
    public readonly dynData: any[],
    public readonly billingClassification?: string,
  ) {
    super();
  }
}
