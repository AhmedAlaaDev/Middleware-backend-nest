import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICreateDataEnhancedRecord,
  IDataEnhancedRecord,
} from '@/modules/data-batch/interfaces/data-enhanced-record.interface';
import { DataEnhancedRecordRepository } from '@/modules/data-batch/repositories/interfaces/data-enhanced-record.repository';
import { DataEnhancedRecord } from '@/modules/data-batch/schemas';

@Injectable()
export class DataEnhancedRecordMongoRepository implements DataEnhancedRecordRepository {
  constructor(
    @InjectModel(DataEnhancedRecord.name)
    private readonly model: Model<DataEnhancedRecord>,
  ) {}

  public async insertMany(records: ICreateDataEnhancedRecord[]): Promise<void> {
    await this.model.insertMany(records);
  }

  public async deleteMany(batchId: string): Promise<void> {
    await this.model.deleteMany({ batchId });
  }

  public async getList(batchId?: string): Promise<IDataEnhancedRecord[]> {
    const filter: Record<string, unknown> = {};
    if (batchId) {
      filter.batchId = batchId;
    }
    const res = await this.model.find(filter).lean().exec();
    return res.map((doc) => ({
      id: doc._id.toString(),
      batchId: doc.batchId,
      dimensionModel: doc.dimensionModel,
      sourceIds: doc.sourceIds || [],
      data: doc.data,
      dataModelType: doc.dataModelType,
    }));
  }

  public getListStream(batchId?: string): any {
    const filter: Record<string, unknown> = {};
    if (batchId) {
      filter.batchId = batchId;
    }
    return this.model.find(filter).lean().cursor();
  }
}
