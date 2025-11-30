import { ICommand } from '@nestjs/cqrs';
import { EntryProcessorTypes } from '../schemas/data-batch.schema';

export class CreateDataBatchCommand implements ICommand {
  entryProcessorType: EntryProcessorTypes;
  entryProcessorName: string;
  companyId: string;
  description: string;
  rawData: any[];
  dynData: any[];
  billingClassification?: string;
}

