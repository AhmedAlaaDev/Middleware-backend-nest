import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { DurablePostingJobPayload } from '@/modules/queue/contracts/durable-posting-job.contract';
import {
  QueueJobGroup,
  QueueJobGroupStatus,
} from '@/modules/queue/schemas/queue-job-group.schema';
import {
  DurableQueueJobStatus,
  QueueJob,
} from '@/modules/queue/schemas/queue-job.schema';

export interface PrepareDurableJobInput extends DurablePostingJobPayload {
  jobId: string;
  queueName: string;
  jobName: string;
  groups: unknown[];
}

@Injectable()
export class QueueJobStoreService {
  constructor(
    @InjectModel(QueueJob.name)
    private readonly jobs: Model<QueueJob>,
    @InjectModel(QueueJobGroup.name)
    private readonly groups: Model<QueueJobGroup>,
  ) {}

  async prepare(input: PrepareDurableJobInput): Promise<void> {
    const existing = await this.jobs.findOne({ jobId: input.jobId }).lean();
    if (
      existing &&
      [
        DurableQueueJobStatus.QUEUED,
        DurableQueueJobStatus.ACTIVE,
        DurableQueueJobStatus.RETRYING,
      ].includes(existing.status)
    ) {
      return;
    }

    await this.replace(input);
  }

  async replace(input: PrepareDurableJobInput): Promise<void> {
    await this.groups.deleteMany({ jobId: input.jobId });
    for (let start = 0; start < input.groups.length; start += 500) {
      const groupChunk = input.groups.slice(start, start + 500);
      await this.groups.insertMany(
        groupChunk.map((payload, offset) => ({
          jobId: input.jobId,
          index: start + offset,
          payload,
          status: QueueJobGroupStatus.PENDING,
        })),
        { ordered: true },
      );
    }
    await this.jobs.findOneAndUpdate(
      { jobId: input.jobId },
      {
        $set: {
          queueName: input.queueName,
          jobName: input.jobName,
          batchId: input.batchId,
          company: input.company,
          correlationId: input.correlationId,
          sourceModule: input.sourceModule,
          payloadVersion: input.payloadVersion,
          journalKind: input.journalKind,
          cashDirection: input.cashDirection,
          status: DurableQueueJobStatus.QUEUED,
          totalGroups: input.groups.length,
          completedGroups: 0,
          retryCount: 0,
          error: null,
          completedAt: null,
          failedAt: null,
        },
      },
      { upsert: true, new: true },
    );
  }

  async getJob(jobId: string) {
    const job = await this.jobs.findOne({ jobId }).lean().exec();
    if (!job) throw new NotFoundException(`Durable job ${jobId} not found`);
    return job;
  }

  async listGroups<T>(jobId: string) {
    return this.groups
      .find({ jobId })
      .sort({ index: 1 })
      .lean<Array<QueueJobGroup & { payload: T }>>()
      .exec();
  }

  async markActive(jobId: string, retryCount: number): Promise<void> {
    await this.jobs.updateOne(
      { jobId },
      {
        $set: {
          status: DurableQueueJobStatus.ACTIVE,
          heartbeatAt: new Date(),
          retryCount,
        },
      },
    );
  }

  async heartbeat(jobId: string): Promise<void> {
    await this.jobs.updateOne({ jobId }, { $set: { heartbeatAt: new Date() } });
  }

  async markGroupActive(jobId: string, index: number): Promise<void> {
    await this.groups.updateOne(
      { jobId, index },
      { $set: { status: QueueJobGroupStatus.ACTIVE } },
    );
    await this.heartbeat(jobId);
  }

  async setCreatedHeader(
    jobId: string,
    index: number,
    createdHeaderId: string,
  ): Promise<void> {
    await this.groups.updateOne(
      { jobId, index },
      { $set: { createdHeaderId } },
    );
    await this.heartbeat(jobId);
  }

  async completeGroup(jobId: string, index: number): Promise<void> {
    const result = await this.groups.updateOne(
      {
        jobId,
        index,
        status: { $ne: QueueJobGroupStatus.COMPLETED },
      },
      {
        $set: {
          status: QueueJobGroupStatus.COMPLETED,
          completedAt: new Date(),
        },
      },
    );
    if (result.modifiedCount) {
      await this.jobs.updateOne(
        { jobId },
        {
          $inc: { completedGroups: 1 },
          $set: { heartbeatAt: new Date() },
        },
      );
    }
  }

  async resetAfterRollback(
    jobId: string,
    attemptedHeaderIds: string[] = [],
    retainedHeaderIds: string[] = [],
  ): Promise<void> {
    const clearedHeaderIds = attemptedHeaderIds.filter(
      (headerId) => !retainedHeaderIds.includes(headerId),
    );
    await this.groups.updateMany(
      {
        jobId,
        $or: [
          { createdHeaderId: { $in: clearedHeaderIds } },
          {
            status: QueueJobGroupStatus.ACTIVE,
            createdHeaderId: { $exists: false },
          },
        ],
      },
      {
        $set: { status: QueueJobGroupStatus.PENDING },
        $unset: { createdHeaderId: 1, completedAt: 1 },
      },
    );
    if (retainedHeaderIds.length) {
      await this.groups.updateMany(
        { jobId, createdHeaderId: { $in: retainedHeaderIds } },
        {
          $set: { status: QueueJobGroupStatus.ACTIVE },
          $unset: { completedAt: 1 },
        },
      );
    }
    const completedGroups = await this.groups.countDocuments({
      jobId,
      status: QueueJobGroupStatus.COMPLETED,
    });
    await this.jobs.updateOne(
      { jobId },
      { $set: { completedGroups, heartbeatAt: new Date() } },
    );
  }

  async markRetrying(jobId: string, error: string): Promise<void> {
    await this.jobs.updateOne(
      { jobId },
      {
        $set: {
          status: DurableQueueJobStatus.RETRYING,
          error,
          heartbeatAt: new Date(),
        },
      },
    );
  }

  async markCompleted(jobId: string): Promise<void> {
    await this.jobs.updateOne(
      { jobId },
      {
        $set: {
          status: DurableQueueJobStatus.COMPLETED,
          completedAt: new Date(),
          heartbeatAt: new Date(),
        },
        $unset: { error: 1 },
      },
    );
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    await this.jobs.updateOne(
      { jobId },
      {
        $set: {
          status: DurableQueueJobStatus.FAILED,
          failedAt: new Date(),
          heartbeatAt: new Date(),
          error,
        },
      },
    );
  }

  async listRecent(limit = 100) {
    return this.jobs.find().sort({ createdAt: -1 }).limit(limit).lean().exec();
  }

  async listQueueJobs(
    queueName: string,
    filters: {
      page?: number;
      limit?: number;
      status?: string;
      jobId?: string;
      batchId?: string;
      from?: string;
      to?: string;
      sortBy?: string;
      sortDirection?: 'asc' | 'desc';
    },
  ) {
    const page = Math.max(Number(filters.page) || 1, 1);
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 500);
    const skip = (page - 1) * limit;

    const query: Record<string, any> = { queueName };

    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.jobId) {
      query.jobId = filters.jobId;
    }
    if (filters.batchId) {
      query.batchId = filters.batchId;
    }
    if (filters.from || filters.to) {
      query.createdAt = {};
      if (filters.from) query.createdAt.$gte = new Date(filters.from);
      if (filters.to) query.createdAt.$lte = new Date(filters.to);
    }

    const sortByField = filters.sortBy || 'createdAt';
    const sortDir = filters.sortDirection === 'asc' ? 1 : -1;
    const sortObj = { [sortByField]: sortDir, _id: -1 } as any;

    const total = await this.jobs.countDocuments(query).exec();
    const totalPages = Math.ceil(total / limit);

    const items = await this.jobs
      .find(query)
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return {
      data: items,
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

  async listRecoverable() {
    return this.jobs
      .find({
        status: {
          $in: [
            DurableQueueJobStatus.QUEUED,
            DurableQueueJobStatus.ACTIVE,
            DurableQueueJobStatus.RETRYING,
          ],
        },
      })
      .lean()
      .exec();
  }
}
