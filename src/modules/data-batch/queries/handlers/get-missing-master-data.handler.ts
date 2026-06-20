import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IMissingMasterDataPaginatedResponse } from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';
import { GetMissingMasterDataQuery } from '@/modules/data-batch/queries/get-missing-master-data.query';
import { DataBatchMissingMasterDataRepository } from '@/modules/data-batch/repositories/interfaces/data-batch-missing-master-data.repository';

@QueryHandler(GetMissingMasterDataQuery)
export class GetMissingMasterDataHandler
  implements IQueryHandler<GetMissingMasterDataQuery>
{
  constructor(
    private readonly missingMasterDataRepo: DataBatchMissingMasterDataRepository,
  ) {}

  public async execute(
    query: GetMissingMasterDataQuery,
  ): Promise<IMissingMasterDataPaginatedResponse> {
    const { batchId, type, creationStatus, page, limit, search } = query;
    return this.missingMasterDataRepo.getPaginatedList(batchId, {
      page,
      limit,
      type,
      creationStatus,
      search,
    });
  }
}

