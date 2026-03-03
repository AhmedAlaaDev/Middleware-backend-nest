import { Command } from '@nestjs/cqrs';

export interface PostCashBatchToDFOResult {
  jobId: string;
  message: string;
}

export class PostCashBatchToDFOCommand extends Command<PostCashBatchToDFOResult> {
  constructor(public readonly batchId: string) {
    super();
  }
}

