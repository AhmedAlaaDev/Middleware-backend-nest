import { Command } from '@nestjs/cqrs';

import { DurablePostingSubmissionResult } from '@/modules/queue/contracts/durable-posting-job.contract';

export type PostARBatchToDFOResult = DurablePostingSubmissionResult;

export class PostARBatchToDFOCommand extends Command<PostARBatchToDFOResult> {
  constructor(public readonly batchId: string) {
    super();
  }
}
