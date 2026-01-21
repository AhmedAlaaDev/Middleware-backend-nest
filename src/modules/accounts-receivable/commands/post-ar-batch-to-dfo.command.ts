import { Command } from '@nestjs/cqrs';

export interface PostARBatchToDFOResult {
  jobId: string;
  message: string;
}

export class PostARBatchToDFOCommand extends Command<PostARBatchToDFOResult> {
  constructor(public readonly batchId: string) {
    super();
  }
}
