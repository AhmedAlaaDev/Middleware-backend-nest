import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import {
  ICreateDataBatch,
  IDataBatch,
  IUpdateDataBatch,
} from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchRepository } from '@/modules/data-batch/repositories/interfaces/data-batch-repository';
import { DataBatch, DataBatchDocument } from '@/modules/data-batch/schemas';

@Injectable()
export class DataBatchMongoRepository extends DataBatchRepository {
  constructor(
    @InjectModel(DataBatch.name)
    private readonly model: Model<DataBatchDocument>,
  ) {
    super();
  }

  public async create(data: ICreateDataBatch): Promise<IDataBatch> {
    const doc = await this.model.create(data);
    return {
      id: doc._id.toString(),
      company: doc.company,
      entryProcessorType: doc.entryProcessorType,
      entryProcessorName: doc.entryProcessorName,
      description: doc.description,
      successCount: doc.successCount,
      errorCount: doc.errorCount,
      totalFormattedCount: doc.totalFormattedCount,
      totalUploadedCount: doc.totalUploadedCount,
      withholdingRemovedCount: doc.withholdingRemovedCount ?? 0,
      withholdingRemovedAmount: doc.withholdingRemovedAmount ?? 0,
      status: doc.status,
      billingCodeId: doc.billingCodeId,
      expectedGroupCount: doc.expectedGroupCount,
      activeValidationRunId: doc.activeValidationRunId,
      createdByUserId: doc.createdByUserId,
      createdByName: doc.createdByName,
      createdByEmail: doc.createdByEmail,
      reprocessCount: doc.reprocessCount,
      sourceColumnHeaders: doc.sourceColumnHeaders,
      creationDate: (doc as any).created_at ?? null,
    };
  }

  public async deleteOne(batchId: string): Promise<void> {
    await this.model.deleteOne({ _id: batchId });
  }

  public async findById(batchId: string): Promise<IDataBatch | null> {
    const doc = await this.model.findOne({ _id: batchId }).lean();

    if (!doc) return null;

    return {
      id: doc._id.toString(),
      company: doc.company,
      entryProcessorType: doc.entryProcessorType,
      entryProcessorName: doc.entryProcessorName,
      description: doc.description,
      successCount: doc.successCount,
      errorCount: doc.errorCount,
      totalFormattedCount: doc.totalFormattedCount,
      totalUploadedCount: doc.totalUploadedCount,
      withholdingRemovedCount: doc.withholdingRemovedCount ?? 0,
      withholdingRemovedAmount: doc.withholdingRemovedAmount ?? 0,
      status: doc.status,
      billingCodeId: doc.billingCodeId,
      expectedGroupCount: doc.expectedGroupCount,
      activeValidationRunId: doc.activeValidationRunId,
      dfoIds: doc.dfoIds,
      dfoPostingErrors: doc.dfoPostingErrors,
      createdByUserId: doc.createdByUserId,
      createdByName: doc.createdByName,
      createdByEmail: doc.createdByEmail,
      lastReprocessedAt: doc.lastReprocessedAt,
      lastReprocessedByUserId: doc.lastReprocessedByUserId,
      lastReprocessedByName: doc.lastReprocessedByName,
      lastReprocessedByEmail: doc.lastReprocessedByEmail,
      reprocessCount: doc.reprocessCount ?? 0,
      lastReprocessJobId: doc.lastReprocessJobId,
      lastReprocessStatus: doc.lastReprocessStatus,
      lastReprocessError: doc.lastReprocessError,
      sourceColumnHeaders: doc.sourceColumnHeaders,
      creationDate: (doc as any).created_at ?? null,
    };
  }

  public async updateOne(
    batchId: string,
    data: IUpdateDataBatch,
  ): Promise<void> {
    await this.model.updateOne({ _id: batchId }, { $set: data });
  }

  public async claimForRevalidation(
    batchId: string,
  ): Promise<IDataBatch | null> {
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: batchId,
          status: DataBatchStatus.PendingPosting,
        },
        { $set: { status: DataBatchStatus.Revalidating } },
        { new: true },
      )
      .lean();

    return doc ? this.mapDocument(doc) : null;
  }

  public async recordReprocessQueued(
    batchId: string,
    audit: {
      at: Date;
      userId: string;
      userName: string;
      userEmail: string;
      jobId: string;
    },
  ): Promise<void> {
    await this.model.updateOne(
      { _id: batchId },
      {
        $set: {
          lastReprocessedAt: audit.at,
          lastReprocessedByUserId: audit.userId,
          lastReprocessedByName: audit.userName,
          lastReprocessedByEmail: audit.userEmail,
          lastReprocessJobId: audit.jobId,
          lastReprocessStatus: 'queued',
          lastReprocessError: null,
        },
        $inc: { reprocessCount: 1 },
      },
    );
  }

  public async getList(
    filter: { entryProcessorTypes?: number[]; batchNumberIds?: string[] },
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IDataBatch[]> {
    const q: Record<string, unknown> = {};

    if (filter?.entryProcessorTypes && filter.entryProcessorTypes.length > 0) {
      q['entryProcessorType'] = { $in: filter.entryProcessorTypes } as unknown;
    }

    if (filter?.batchNumberIds && filter.batchNumberIds.length > 0) {
      q['_id'] = { $in: filter.batchNumberIds } as unknown;
    }
    const skip = options?.skipCount ?? 0;
    const limit = options?.maxCount ?? 150;
    const res = await this.model
      .find(q)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return res.map((doc) => ({
      id: doc._id.toString(),
      company: doc.company,
      entryProcessorType: doc.entryProcessorType,
      entryProcessorName: doc.entryProcessorName,
      description: doc.description,
      successCount: doc.successCount,
      errorCount: doc.errorCount,
      totalFormattedCount: doc.totalFormattedCount,
      totalUploadedCount: doc.totalUploadedCount,
      withholdingRemovedCount: doc.withholdingRemovedCount ?? 0,
      withholdingRemovedAmount: doc.withholdingRemovedAmount ?? 0,
      status: doc.status,
      billingCodeId: doc.billingCodeId,
      expectedGroupCount: doc.expectedGroupCount,
      activeValidationRunId: doc.activeValidationRunId,
      dfoIds: doc.dfoIds,
      dfoPostingErrors: doc.dfoPostingErrors,
      createdByUserId: doc.createdByUserId,
      createdByName: doc.createdByName,
      createdByEmail: doc.createdByEmail,
      lastReprocessedAt: doc.lastReprocessedAt,
      lastReprocessedByUserId: doc.lastReprocessedByUserId,
      lastReprocessedByName: doc.lastReprocessedByName,
      lastReprocessedByEmail: doc.lastReprocessedByEmail,
      reprocessCount: doc.reprocessCount ?? 0,
      lastReprocessJobId: doc.lastReprocessJobId,
      lastReprocessStatus: doc.lastReprocessStatus,
      lastReprocessError: doc.lastReprocessError,
      sourceColumnHeaders: doc.sourceColumnHeaders,
      creationDate: (doc as any).created_at ?? null,
    }));
  }

  public async getCount(filter: {
    entryProcessorTypes?: number[];
    batchNumberIds?: string[];
  }): Promise<number> {
    const q: Record<string, unknown> = {};
    if (filter?.entryProcessorTypes && filter.entryProcessorTypes.length > 0) {
      q['entryProcessorType'] = { $in: filter.entryProcessorTypes } as unknown;
    }

    if (filter?.batchNumberIds && filter.batchNumberIds.length > 0) {
      q['_id'] = { $in: filter.batchNumberIds } as unknown;
    }
    return this.model.countDocuments(q).exec();
  }

  private mapDocument(doc: any): IDataBatch {
    return {
      id: doc._id.toString(),
      company: doc.company,
      entryProcessorType: doc.entryProcessorType,
      entryProcessorName: doc.entryProcessorName,
      description: doc.description,
      successCount: doc.successCount,
      errorCount: doc.errorCount,
      totalFormattedCount: doc.totalFormattedCount,
      totalUploadedCount: doc.totalUploadedCount,
      withholdingRemovedCount: doc.withholdingRemovedCount ?? 0,
      withholdingRemovedAmount: doc.withholdingRemovedAmount ?? 0,
      status: doc.status,
      billingCodeId: doc.billingCodeId,
      expectedGroupCount: doc.expectedGroupCount,
      activeValidationRunId: doc.activeValidationRunId,
      dfoIds: doc.dfoIds,
      dfoPostingErrors: doc.dfoPostingErrors,
      createdByUserId: doc.createdByUserId,
      createdByName: doc.createdByName,
      createdByEmail: doc.createdByEmail,
      lastReprocessedAt: doc.lastReprocessedAt,
      lastReprocessedByUserId: doc.lastReprocessedByUserId,
      lastReprocessedByName: doc.lastReprocessedByName,
      lastReprocessedByEmail: doc.lastReprocessedByEmail,
      reprocessCount: doc.reprocessCount ?? 0,
      lastReprocessJobId: doc.lastReprocessJobId,
      lastReprocessStatus: doc.lastReprocessStatus,
      lastReprocessError: doc.lastReprocessError,
      sourceColumnHeaders: doc.sourceColumnHeaders,
      creationDate: doc.created_at ?? null,
    };
  }
}
