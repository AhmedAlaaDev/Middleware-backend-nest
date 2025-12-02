import { Query } from '@nestjs/cqrs';

import { PaginatedResDto } from '@/common/dtos/paginated-res.dto';
import { DataBatchError } from '@/modules/db/schemas/data-batch-error.schema';

export class GetBatchErrorListQuery extends Query<
  PaginatedResDto<DataBatchError>
> {
  constructor(
    public readonly batchId: string,
    public readonly skipCount?: number,
    public readonly maxCount?: number,
  ) {
    super();
  }
}
