import { Command } from '@nestjs/cqrs';

export interface PostVendorBatchToDFOResult {
  jobId: string;
  message: string;
}

export class PostVendorBatchToDFOCommand extends Command<PostVendorBatchToDFOResult> {
  constructor(public readonly batchId: string) {
    super();
  }
}
