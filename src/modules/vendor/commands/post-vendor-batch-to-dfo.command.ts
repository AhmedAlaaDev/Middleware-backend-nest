import { Command } from '@nestjs/cqrs';

import { DurablePostingSubmissionResult } from '@/modules/queue/contracts/durable-posting-job.contract';

export type PostVendorBatchToDFOResult = DurablePostingSubmissionResult;

export class PostVendorBatchToDFOCommand extends Command<PostVendorBatchToDFOResult> {
  constructor(public readonly batchId: string) {
    super();
  }
}
