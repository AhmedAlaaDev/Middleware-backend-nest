import { Command } from '@nestjs/cqrs';

export interface PostLedgerBatchToDFOResult {
  jobId: string;
  message: string;
}

export class PostLedgerBatchToDFOCommand extends Command<PostLedgerBatchToDFOResult> {
  constructor(public readonly batchId: string) {
    super();
  }
}
