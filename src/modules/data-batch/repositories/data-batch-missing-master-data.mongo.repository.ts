import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  CustomerCreationStatus,
  IDataBatchMissingMasterData,
  IMissingMasterDataPaginatedResponse,
  IRemediationSummary,
  IUpdateDataBatchMissingMasterData,
  MissingCustomerField,
  MissingMasterDataType,
} from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';
import { DataBatchMissingMasterDataRepository } from '@/modules/data-batch/repositories/interfaces/data-batch-missing-master-data.repository';
import { DataBatchMissingMasterData } from '@/modules/data-batch/schemas/data-batch-missing-master-data.schema';

@Injectable()
export class DataBatchMissingMasterDataMongoRepository implements DataBatchMissingMasterDataRepository {
  constructor(
    @InjectModel(DataBatchMissingMasterData.name)
    private readonly model: Model<DataBatchMissingMasterData>,
  ) {}

  public async deleteMany(batchId: string): Promise<void> {
    await this.model.deleteMany({ batchId }).exec();
  }

  public async getList(
    batchId: string,
    filter?: {
      type?: MissingMasterDataType;
      creationStatus?: CustomerCreationStatus;
    },
  ): Promise<IDataBatchMissingMasterData[]> {
    const q: Record<string, unknown> = { batchId };
    if (filter?.type) {
      q.type = filter.type;
    }
    if (filter?.creationStatus) {
      q.creationStatus = filter.creationStatus;
    }
    const documents = await this.model.find(q).lean().exec();
    return documents.map((document) => this.mapDocument(document));
  }

  public async getPaginatedList(
    batchId: string,
    options: {
      page: number;
      limit: number;
      type?: MissingMasterDataType;
      creationStatus?: CustomerCreationStatus;
      search?: string;
    },
  ): Promise<IMissingMasterDataPaginatedResponse> {
    const { page, limit, type, creationStatus, search } = options;
    const q: Record<string, unknown> = { batchId };

    if (type) {
      q.type = type;
    }
    if (creationStatus) {
      q.creationStatus = creationStatus;
    }
    if (search) {
      q.missingValue = { $regex: search, $options: 'i' };
    }

    const skip = (page - 1) * limit;
    const [documents, total] = await Promise.all([
      this.model.find(q).skip(skip).limit(limit).lean().exec(),
      this.model.countDocuments(q).exec(),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: documents.map((doc) => this.mapDocument(doc)),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  public async getSummary(batchId: string): Promise<IRemediationSummary> {
    const results = await this.model.aggregate<{
      _id: MissingMasterDataType;
      count: number;
      affectedRows: number;
    }>([
      { $match: { batchId } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          affectedRows: { $sum: '$affectedCount' },
        },
      },
    ]);

    const types = results.map((r) => ({
      type: r._id,
      count: r.count,
      affectedRows: r.affectedRows,
    }));

    const total = types.reduce((sum, t) => sum + t.count, 0);

    return { total, types };
  }

  public async findById(
    id: string,
  ): Promise<IDataBatchMissingMasterData | null> {
    const document = await this.model.findById(id).lean().exec();
    return document ? this.mapDocument(document) : null;
  }

  public async updateOne(
    id: string,
    data: IUpdateDataBatchMissingMasterData,
  ): Promise<void> {
    await this.model.findByIdAndUpdate(id, { $set: data }).exec();
  }

  public async claimForCreation(
    id: string,
  ): Promise<IDataBatchMissingMasterData | null> {
    const document = await this.model
      .findOneAndUpdate(
        {
          _id: id,
          creationStatus: { $in: ['missing', 'create_failed'] },
        },
        {
          $set: {
            creationStatus: 'creating',
            createErrorMessage: null,
          },
        },
        { new: true },
      )
      .lean()
      .exec();

    return document ? this.mapDocument(document) : null;
  }

  public async upsert(
    batchId: string,
    type: MissingMasterDataType,
    missingField: MissingCustomerField,
    missingValue: string,
    data: IUpdateDataBatchMissingMasterData & {
      company: string;
      entryProcessorType: number;
    },
  ): Promise<void> {
    await this.model
      .updateOne(
        { batchId, type, missingField, missingValue },
        {
          $set: data,
          $setOnInsert: { batchId, type, missingField, missingValue },
        },
        { upsert: true },
      )
      .exec();
  }

  private mapDocument(document: any): IDataBatchMissingMasterData {
    return {
      id: String(document._id),
      batchId: document.batchId,
      company: document.company,
      entryProcessorType: document.entryProcessorType,
      type: document.type,
      missingField: document.missingField,
      missingValue: document.missingValue,
      creationStatus: document.creationStatus,
      reprocessStatus: document.reprocessStatus,
      affectedCount: document.affectedCount,
      formDefaults: document.formDefaults,
      readonlyFormFields: document.readonlyFormFields ?? [],
      createdData: document.createdData,
      createErrorMessage: document.createErrorMessage,
      reprocessErrorMessage: document.reprocessErrorMessage,
      reprocessAttempts: document.reprocessAttempts,
    };
  }
}
