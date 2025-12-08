import { Query } from '@nestjs/cqrs';

import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';

export class GetDataBatchByIdQuery extends Query<IDataBatch> {
  constructor(public readonly batchId: string) {
    super();
  }
}

