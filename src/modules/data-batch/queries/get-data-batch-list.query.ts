import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';

export class GetDataBatchListQuery extends Query<IPaginatedRes<IDataBatch>> {
  constructor(
    public readonly entryProcessorTypes?: EntryProcessorTypes[],
    public readonly batchNumberIds?: string[],
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
