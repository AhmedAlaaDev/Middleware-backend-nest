import { IQuery } from '@nestjs/cqrs';

export class GetBatchErrorListQuery implements IQuery {
  batchId: string;
  skipCount: number = 0;
  maxCount: number = 150;
}

