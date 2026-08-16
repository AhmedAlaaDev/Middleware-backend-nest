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
    const job = await this.findByJobId(jobId);
    if (!job) throw new NotFoundException(`Durable job ${jobId} not found`);
    return job;
  }

  /** Same lookup as getJob, but missing rows are null instead of a 404. */
  async findByJobId(jobId: string) {
    return this.jobs.findOne({ jobId }).lean().exec();
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

  /**
   * Record that the worker stopped on a paused batch. Kept apart from failure
   * so the batch is not rolled back and boot recovery leaves it alone.
   */
  async markPaused(jobId: string): Promise<void> {
    await this.jobs.updateOne(
      { jobId },
      {
        $set: {
          status: DurableQueueJobStatus.PAUSED,
          pausedAt: new Date(),
          heartbeatAt: new Date(),
        },
        $unset: { error: 1 },
      },
    );
  }

  /** Put a paused job back in the queued state when posting resumes. */
  async markQueued(jobId: string): Promise<void> {
    await this.jobs.updateOne(
      { jobId },
      {
        $set: {
          status: DurableQueueJobStatus.QUEUED,
          heartbeatAt: new Date(),
        },
        $unset: { pausedAt: 1, error: 1 },
      },
    );
  }

  /** Durable jobs in any of the given statuses, most recent first. */
  async listByStatuses(statuses: DurableQueueJobStatus[], limit = 50) {
    return this.jobs
      .find({ status: { $in: statuses } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  /** Most recent durable job recorded for a batch, in any status. */
  async findLatestForBatch(batchId: string) {
    return this.jobs.findOne({ batchId }).sort({ createdAt: -1 }).lean().exec();
  }

  /**
   * Open posting jobs for a batch: still queued, running, retrying, or stopped
   * on a pause. Used when deleting a batch so its queue work is discarded first.
   */
  async listOpenForBatch(batchId: string) {
    return this.jobs
      .find({
        batchId,
        status: {
          $in: [
            DurableQueueJobStatus.QUEUED,
            DurableQueueJobStatus.ACTIVE,
            DurableQueueJobStatus.RETRYING,
            DurableQueueJobStatus.PAUSED,
          ],
        },
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  /** Drop the durable job and its journal groups after a batch is deleted. */
  async purgeJob(jobId: string): Promise<void> {
    await Promise.all([
      this.groups.deleteMany({ jobId }),
      this.jobs.deleteOne({ jobId }),
    ]);
  }

  /** Permanently delete all durable jobs and their journal groups for a batch. */
  async purgeByBatch(batchId: string): Promise<number> {
    const docs = await this.jobs
      .find({ batchId })
      .select({ jobId: 1 })
      .lean()
      .exec();
    const jobIds = docs.map((doc) => doc.jobId);
    if (jobIds.length > 0) {
      await this.groups.deleteMany({ jobId: { $in: jobIds } });
    }
    const result = await this.jobs.deleteMany({ batchId });
    return result.deletedCount ?? 0;
  }

  /**
   * Permanently delete durable jobs (and their journal groups) for a queue,
   * optionally limited to specific statuses.
   */
  async purgeByQueue(
    queueName: string,
    statuses?: DurableQueueJobStatus[],
  ): Promise<number> {
    const query: Record<string, unknown> = { queueName };
    if (statuses?.length) {
      query.status = { $in: statuses };
    }

    const docs = await this.jobs.find(query).select({ jobId: 1 }).lean().exec();
    const jobIds = docs.map((doc) => doc.jobId);
    if (jobIds.length === 0) return 0;

    await this.groups.deleteMany({ jobId: { $in: jobIds } });
    const result = await this.jobs.deleteMany(query);
    return result.deletedCount ?? 0;
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
