import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import type { IRemediationSummary } from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';

import { GetRemediationSummaryQuery } from '@/modules/data-batch/queries/get-remediation-summary.query';
import { DataBatchMissingMasterDataRepository } from '@/modules/data-batch/repositories/interfaces/data-batch-missing-master-data.repository';

@QueryHandler(GetRemediationSummaryQuery)
export class GetRemediationSummaryHandler implements IQueryHandler<GetRemediationSummaryQuery> {
  constructor(
    private readonly missingMasterDataRepo: DataBatchMissingMasterDataRepository,
  ) {}

  public async execute(
    query: GetRemediationSummaryQuery,
  ): Promise<IRemediationSummary> {
    return this.missingMasterDataRepo.getSummary(query.batchId);
  }
}
