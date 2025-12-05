import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { GetBatchErrorListQuery } from '@/modules/data-batch/queries/get-batch-error-list.query';
import { DBService } from '@/modules/db/db.service';
import { DataBatchError } from '@/modules/db/schemas/data-batch-error.schema';

@QueryHandler(GetBatchErrorListQuery)
export class GetBatchErrorListHandler implements IQueryHandler<GetBatchErrorListQuery> {
  constructor(private readonly db: DBService) {}

  public async execute(
    query: GetBatchErrorListQuery,
  ): Promise<IPaginatedRes<DataBatchError>> {
    const filter = { batchId: query.batchId };

    const data = await this.db.dataBatchErrorModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(query.skipCount || 0)
      .limit(query.maxCount || 150)
      .lean()
      .exec();

    const total = await this.db.dataBatchErrorModel.countDocuments(filter);

    const result = new IPaginatedRes<DataBatchError>(
      data,
      total,
      query.maxCount || 150,
      query.skipCount || 0,
    );

    return result;
  }
}
