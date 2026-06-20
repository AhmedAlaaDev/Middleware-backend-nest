import { Query } from '@nestjs/cqrs';

import type { IRemediationSummary } from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';

export class GetRemediationSummaryQuery extends Query<IRemediationSummary> {
  constructor(public readonly batchId: string) {
    super();
  }
}
