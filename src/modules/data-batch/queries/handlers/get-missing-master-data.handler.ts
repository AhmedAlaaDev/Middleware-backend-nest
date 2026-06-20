import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IDataBatchMissingMasterData } from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';
import { GetMissingMasterDataQuery } from '@/modules/data-batch/queries/get-missing-master-data.query';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';

@QueryHandler(GetMissingMasterDataQuery)
export class GetMissingMasterDataHandler implements IQueryHandler<GetMissingMasterDataQuery> {
  constructor(private readonly dataBatchService: DataBatchService) {}

  public async execute(
    query: GetMissingMasterDataQuery,
  ): Promise<IDataBatchMissingMasterData[]> {
    const { batchId, type, creationStatus } = query;
    return this.dataBatchService.getMissingMasterDataAsync(batchId, {
      type,
      creationStatus,
    });
  }
}
