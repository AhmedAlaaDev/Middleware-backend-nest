import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { GetDataBatchByIdQuery } from '@/modules/data-batch/queries/get-data-batch-by-id.query';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';

@QueryHandler(GetDataBatchByIdQuery)
export class GetDataBatchByIdHandler implements IQueryHandler<GetDataBatchByIdQuery> {
  constructor(private readonly dataBatchService: DataBatchService) {}

  public async execute(query: GetDataBatchByIdQuery): Promise<IDataBatch> {
    const batch = await this.dataBatchService.getByIdAsync(query.batchId);

    if (!batch) {
      throw new NotFoundException(
        `Data batch with ID ${query.batchId} not found`,
      );
    }

    return batch;
  }
}
