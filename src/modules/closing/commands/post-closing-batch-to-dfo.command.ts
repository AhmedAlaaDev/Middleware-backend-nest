import { Command } from '@nestjs/cqrs';

export interface PostClosingBatchToDFOResult {
  jobId: string;
  message: string;
}

export class PostClosingBatchToDFOCommand extends Command<PostClosingBatchToDFOResult> {
  constructor(public readonly batchId: string) {
    super();
  }
}
