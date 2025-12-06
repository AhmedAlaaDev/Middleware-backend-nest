import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { IDataBatchError } from '@/modules/data-batch/interfaces/data-batch-error.interface';
import { GetBatchErrorListQuery } from '@/modules/data-batch/queries/get-batch-error-list.query';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';

@QueryHandler(GetBatchErrorListQuery)
export class GetBatchErrorListHandler implements IQueryHandler<GetBatchErrorListQuery> {
  constructor(private readonly dataBatchservice: DataBatchService) {}

  public async execute(
    query: GetBatchErrorListQuery,
  ): Promise<IPaginatedRes<IDataBatchError>> {
    const { items, total } = await this.dataBatchservice.getBatchErrorListAsync(
      query.batchId,
      query.skipCount || 0,
      query.maxCount || 150,
    );

    const result = new IPaginatedRes<IDataBatchError>(
      items,
      total,
      query.maxCount || 150,
      query.skipCount || 0,
    );

    return result;
  }
}
