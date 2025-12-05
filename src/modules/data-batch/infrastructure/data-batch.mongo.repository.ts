import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreateDataBatch,
  IDataBatch,
  IUpdateDataBatch,
} from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchRepository } from '@/modules/data-batch/repositories/data-batch-repository';
import { DataBatch } from '@/modules/db/schemas/data-batch.schema';

@Injectable()
export class DataBatchMongoRepository extends DataBatchRepository {
  constructor(
    @InjectModel(DataBatch.name)
    private readonly model: Model<DataBatch>,
  ) {
    super();
  }

  public async create(data: ICreateDataBatch): Promise<IDataBatch> {
    const doc = await this.model.create(data);

    return {
      id: doc._id.toString(),
      ...doc,
    };
  }

  public async deleteOne(batchId: string): Promise<void> {
    await this.model.deleteOne({ batchId });
  }

  public async findById(batchId: string): Promise<IDataBatch | null> {
    const doc = await this.model.findOne({ batchId }).lean();

    if (!doc) return null;

    return {
      id: doc._id.toString(),
      ...doc,
    };
  }

  public async updateOne(
    batchId: string,
    data: IUpdateDataBatch,
  ): Promise<void> {
    await this.model.updateOne({ batchId }, { $set: data });
  }
}
