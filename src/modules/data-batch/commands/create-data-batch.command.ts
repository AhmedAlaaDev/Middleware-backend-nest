import { Command } from '@nestjs/cqrs';

import {
  DataBatch,
  EntryProcessorTypes,
} from '@/modules/db/schemas/data-batch.schema';

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
