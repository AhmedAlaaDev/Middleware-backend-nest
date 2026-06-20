import { Command } from '@nestjs/cqrs';

import { DurablePostingSubmissionResult } from '@/modules/queue/contracts/durable-posting-job.contract';

export type PostCashBatchToDFOResult = DurablePostingSubmissionResult;

export class PostCashBatchToDFOCommand extends Command<PostCashBatchToDFOResult> {
  constructor(public readonly batchId: string) {
    super();
  }
}
