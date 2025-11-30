import { IQuery } from '@nestjs/cqrs';
import { EntryProcessorTypes } from '../schemas/data-batch.schema';

export class GetDataBatchListQuery implements IQuery {
  entryProcessorTypes?: EntryProcessorTypes[];
  batchNumberIds?: string[];
  skipCount: number = 0;
  maxCount: number = 150;
}

