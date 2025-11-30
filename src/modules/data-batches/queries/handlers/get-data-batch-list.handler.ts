import { IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GetDataBatchListQuery } from '../get-data-batch-list.query';
import { DataBatch } from '../../schemas/data-batch.schema';
import { OperationResultDto } from '../../../../common/dto/operation-result.dto';
import { PaginatedResultDto } from '../../../../common/dto/paginated-result.dto';

@QueryHandler(GetDataBatchListQuery)
export class GetDataBatchListHandler
  implements IQueryHandler<GetDataBatchListQuery>
{
  constructor(
    @InjectModel(DataBatch.name)
    private readonly dataBatchModel: Model<DataBatch>,
  ) {}

  async execute(
    query: GetDataBatchListQuery,
  ): Promise<OperationResultDto<PaginatedResultDto<any>>> {
    const filter: any = {};

    if (query.entryProcessorTypes && query.entryProcessorTypes.length > 0) {
      filter.entryProcessorType = { $in: query.entryProcessorTypes };
    }

    if (query.batchNumberIds && query.batchNumberIds.length > 0) {
      filter._id = { $in: query.batchNumberIds };
    }

    const total = await this.dataBatchModel.countDocuments(filter);

    const data = await this.dataBatchModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(query.skipCount)
      .limit(query.maxCount)
      .lean()
      .exec();

    const result = new PaginatedResultDto(
      data,
      total,
      query.maxCount,
      query.skipCount,
    );

    return OperationResultDto.success(result);
  }
}

