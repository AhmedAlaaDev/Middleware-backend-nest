import { Query } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { IDataBatchError } from '@/modules/data-batch/interfaces/data-batch-error.interface';

export class GetBatchErrorListQuery extends Query<
  IPaginatedRes<IDataBatchError>
> {
  constructor(
    public readonly batchId: string,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
