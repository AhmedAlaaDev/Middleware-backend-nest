import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreateDataSourceRecord,
  IDataSourceRecord,
} from '@/modules/data-batch/interfaces/data-source-record.interface';
import { DataSourceRecordRepository } from '@/modules/data-batch/repositories/interfaces/data-source-record.repository';
import { DataSourceRecord } from '@/modules/data-batch/schemas';

@Injectable()
export class DataSourceRecordMongoRepository implements DataSourceRecordRepository {
  constructor(
    @InjectModel(DataSourceRecord.name)
    private readonly model: Model<DataSourceRecord>,
  ) {}

  public async insertMany(records: ICreateDataSourceRecord[]): Promise<void> {
    await this.model.insertMany(records);
  }

  public async deleteMany(batchId: string): Promise<void> {
    await this.model.deleteMany({ batchId });
  }

  public async getList(batchId?: string): Promise<IDataSourceRecord[]> {
    const filter: Record<string, unknown> = {};
    if (batchId) {
      filter.batchId = batchId;
    }
    const res = await this.model.find(filter).lean().exec();
    return res.map((doc) => ({
      id: doc._id.toString(),
      batchId: doc.batchId,
      data: doc.data,
    }));
  }

  public getListStream(batchId: string): any {
    return this.model.find({ batchId }).lean().cursor();
  }
}
