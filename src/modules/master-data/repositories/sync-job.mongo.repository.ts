import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { SyncJobStatus } from '@/modules/master-data/enums/sync-job-status.enum';
import { ISyncJob } from '@/modules/master-data/interfaces/sync-job.interface';
import { SyncJobRepository } from '@/modules/master-data/repositories/interfaces/sync-job.repository';
import { SyncJob } from '@/modules/master-data/schemas/sync-job.schema';

@Injectable()
export class SyncJobMongoRepository implements SyncJobRepository {
  constructor(
    @InjectModel(SyncJob.name)
    private readonly model: Model<SyncJob>,
  ) {}

  async create(name: string): Promise<ISyncJob> {
    const doc = await this.model.create({
      name,
      status: SyncJobStatus.PENDING,
    });
    return this.toInterface(doc);
  }

  async updateStatus(
    id: string,
    status: SyncJobStatus,
    errorMessage?: string,
  ): Promise<void> {
    const update: Partial<SyncJob> = { status };
    if (errorMessage !== undefined) {
      update.errorMessage = errorMessage;
    } else if (status !== SyncJobStatus.FAILED) {
      // A queue retry reuses the same document, so a job that is no longer
      // failed must stop reporting the previous error.
      update.errorMessage = '';
    }
    await this.model.findByIdAndUpdate(id, update).exec();
  }

  async getList(): Promise<ISyncJob[]> {
    const docs = await this.model.find().lean().sort({ created_at: -1 }).exec();
    return docs.map((doc) => this.toInterface(doc));
  }

  async findByName(name: string): Promise<ISyncJob | null> {
    const doc = await this.model.findOne({ name }).lean().exec();
    if (!doc) return null;
    return this.toInterface(doc);
  }

  async findById(id: string): Promise<ISyncJob | null> {
    const doc = await this.model.findById(id).lean().exec();
    if (!doc) return null;
    return this.toInterface(doc);
  }

  async findLatestBySyncType(syncType: string): Promise<ISyncJob | null> {
    // Find the latest job that starts with the sync type
    const doc = await this.model
      .findOne({ name: this.syncTypeNameFilter(syncType) })
      .lean()
      .sort({ created_at: -1 })
      .exec();
    if (!doc) return null;
    return this.toInterface(doc);
  }

  async hasPendingOrProcessingJob(syncType: string): Promise<boolean> {
    const count = await this.model
      .countDocuments({
        name: this.syncTypeNameFilter(syncType),
        status: {
          $in: [SyncJobStatus.PENDING, SyncJobStatus.PROCESSING],
        },
      })
      .exec();
    return count > 0;
  }

  // Job names are `<syncType>-<scope>-<timestamp>`, so the sync type is a
  // literal prefix and must not be interpreted as a regex pattern.
  private syncTypeNameFilter(syncType: string): RegExp {
    const escaped = syncType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}-`);
  }

  private toInterface(doc: any): ISyncJob {
    return {
      id: doc._id.toString(),
      name: doc.name,
      status: doc.status,
      errorMessage: doc.errorMessage,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    };
  }
}
