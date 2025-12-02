import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { GetDataBatchListQuery } from '@/modules/data-batch/queries/get-data-batch-list.query';
import { DBService } from '@/modules/db/db.service';
import { DataBatch } from '@/modules/db/schemas/data-batch.schema';

@QueryHandler(GetDataBatchListQuery)
export class GetDataBatchListHandler implements IQueryHandler<GetDataBatchListQuery> {
  constructor(private readonly db: DBService) {}

  public async execute(
    query: GetDataBatchListQuery,
  ): Promise<IPaginatedRes<DataBatch>> {
    const filter: any = {};

    if (query.entryProcessorTypes && query.entryProcessorTypes.length > 0) {
      filter.entryProcessorType = { $in: query.entryProcessorTypes };
    }

    if (query.batchNumberIds && query.batchNumberIds.length > 0) {
      filter._id = { $in: query.batchNumberIds };
    }

    const total = await this.db.dataBatchModel.countDocuments(filter);

    const data = await this.db.dataBatchModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(query.skipCount || 0)
      .limit(query.maxCount || 150)
      .lean()
      .exec();

    const result = new IPaginatedRes<DataBatch>(
      data,
      total,
      query.maxCount || 150,
      query.skipCount || 0,
    );

    return result;
  }
}
