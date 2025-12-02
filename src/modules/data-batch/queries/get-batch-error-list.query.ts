import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { DataBatchError } from '@/modules/db/schemas/data-batch-error.schema';

export class GetBatchErrorListQuery extends Query<
  IPaginatedRes<DataBatchError>
> {
  constructor(
    public readonly batchId: string,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
