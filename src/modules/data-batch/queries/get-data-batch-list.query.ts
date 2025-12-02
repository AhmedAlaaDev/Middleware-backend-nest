import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import {
  DataBatch,
  EntryProcessorTypes,
} from '@/modules/db/schemas/data-batch.schema';

export class GetDataBatchListQuery extends Query<IPaginatedRes<DataBatch>> {
  constructor(
    public readonly entryProcessorTypes?: EntryProcessorTypes[],
    public readonly batchNumberIds?: string[],
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
