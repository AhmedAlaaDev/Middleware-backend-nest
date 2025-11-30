import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GetBatchErrorListQuery } from '../get-batch-error-list.query';
import { DataBatchError } from '../../schemas/data-batch-error.schema';
import { OperationResultDto } from '../../../../common/dto/operation-result.dto';
import { PaginatedResultDto } from '../../../../common/dto/paginated-result.dto';

@QueryHandler(GetBatchErrorListQuery)
export class GetBatchErrorListHandler
  implements IQueryHandler<GetBatchErrorListQuery>
{
  constructor(
    @InjectModel(DataBatchError.name)
    private readonly batchErrorModel: Model<DataBatchError>,
  ) {}

  async execute(
    query: GetBatchErrorListQuery,
  ): Promise<OperationResultDto<PaginatedResultDto<any>>> {
    const filter = { batchId: query.batchId };

    const total = await this.batchErrorModel.countDocuments(filter);

    const data = await this.batchErrorModel
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

