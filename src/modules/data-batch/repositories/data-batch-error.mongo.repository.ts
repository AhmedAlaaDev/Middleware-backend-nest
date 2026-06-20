import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreateDataBatchError,
  IDataBatchError,
  IDataBatchErrorListFilter,
} from '@/modules/data-batch/interfaces/data-batch-error.interface';
import { DataBatchErrorRepository } from '@/modules/data-batch/repositories/interfaces/data-batch-error.repository';
import { DataBatchError } from '@/modules/data-batch/schemas';

@Injectable()
export class DataBatchErrorMongoRepository implements DataBatchErrorRepository {
  constructor(
    @InjectModel(DataBatchError.name)
    private readonly model: Model<DataBatchError>,
  ) {}

  /**
   * Insert multiple batch errors
   */
  public async insertMany(
    dataBatchErrors: ICreateDataBatchError[],
  ): Promise<void> {
    await this.model.insertMany(dataBatchErrors);
  }

  /**
   * Delete multiple batch errors
   */
  public async deleteMany(
    batchId: string,
    validationRunId?: string,
  ): Promise<void> {
    await this.model.deleteMany({
      batchId,
      ...(validationRunId ? { validationRunId } : {}),
    });
  }

  /**
   * Get multiple batch errors
   */
  public async getList(
    filter?: IDataBatchErrorListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IDataBatchError[]> {
    const skip = options?.skipCount ?? 0;
    const limit = options?.maxCount ?? 150;
    const filterQuery: Record<string, any> = {};
    if (filter?.batchId) {
      filterQuery.batchId = filter.batchId;
    }
    if (filter?.validationRunId) {
      filterQuery.validationRunId = filter.validationRunId;
    }

    const res = await this.model
      .find(filterQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return res.map((doc) => ({
      id: doc._id.toString(),
      batchId: doc.batchId,
      sourceRecordIds: doc.sourceRecordIds || [],
      errorMessages: doc.errorMessages || [],
      accountDimensionsModel: doc.accountDimensionsModel,
      enhancedRecordIds: doc.enhancedRecordIds || [],
      enhancedData: doc.enhancedData,
      validationRunId: doc.validationRunId,
    }));
  }

  /**
   * Get count of batch errors
   */
  public async getCount(filter: IDataBatchErrorListFilter): Promise<number> {
    const filterQuery: Record<string, any> = {};
    if (filter?.batchId) {
      filterQuery.batchId = filter.batchId;
    }
    if (filter?.validationRunId) {
      filterQuery.validationRunId = filter.validationRunId;
    }
    return this.model.countDocuments(filterQuery).exec();
  }

  /**
   * Get batch errors stream (memory-efficient)
   */
  public getListStream(filter: IDataBatchErrorListFilter): any {
    const filterQuery: Record<string, any> = {};
    if (filter?.batchId) {
      filterQuery.batchId = filter.batchId;
    }
    if (filter?.validationRunId) {
      filterQuery.validationRunId = filter.validationRunId;
    }
    return this.model.find(filterQuery).sort({ createdAt: -1 }).lean().cursor();
  }
}
