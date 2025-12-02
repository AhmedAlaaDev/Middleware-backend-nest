import { Query } from '@nestjs/cqrs';

import { PaginatedResDto } from '@/common/dtos/paginated-res.dto';
import {
  DataBatch,
  EntryProcessorTypes,
} from '@/modules/db/schemas/data-batch.schema';

export class GetDataBatchListQuery extends Query<PaginatedResDto<DataBatch>> {
  constructor(
    public readonly entryProcessorTypes?: EntryProcessorTypes[],
    public readonly batchNumberIds?: string[],
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
