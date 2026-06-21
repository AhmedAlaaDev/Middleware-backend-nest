import { Command } from '@nestjs/cqrs';

import { DataBatchReprocessSubmission } from '@/modules/queue/contracts/data-batch-reprocess-job.contract';

export class ReprocessBatchCommand extends Command<DataBatchReprocessSubmission> {
  constructor(
    public readonly batchId: string,
    public readonly actor: {
      id: string;
      name: string;
      email: string;
    },
  ) {
    super();
  }
}
