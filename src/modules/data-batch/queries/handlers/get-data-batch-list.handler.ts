import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { GetDataBatchListQuery } from '@/modules/data-batch/queries/get-data-batch-list.query';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';

@QueryHandler(GetDataBatchListQuery)
export class GetDataBatchListHandler implements IQueryHandler<GetDataBatchListQuery> {
  constructor(private readonly dataBatchService: DataBatchService) {}

  public async execute(
    query: GetDataBatchListQuery,
  ): Promise<IPaginatedRes<IDataBatch>> {
    const { items, total } = await this.dataBatchService.getDataBatchListAsync(
      {
        entryProcessorTypes: query.entryProcessorTypes,
        batchNumberIds: query.batchNumberIds,
      },
      query.skipCount || 0,
      query.maxCount || 150,
    );

    const result = new IPaginatedRes<IDataBatch>(
      items,
      total,
      query.maxCount || 150,
      query.skipCount || 0,
    );

    return result;
  }
}
