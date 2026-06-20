import { Command } from '@nestjs/cqrs';

import { DurablePostingSubmissionResult } from '@/modules/queue/contracts/durable-posting-job.contract';

export type PostClosingBatchToDFOResult = DurablePostingSubmissionResult;

export class PostClosingBatchToDFOCommand extends Command<PostClosingBatchToDFOResult> {
  constructor(public readonly batchId: string) {
    super();
  }
}
