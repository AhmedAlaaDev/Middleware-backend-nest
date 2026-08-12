import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { ApplicationLogFiltersDto } from '@/modules/observability/dto/application-log-filters.dto';
import { ApplicationLog } from '@/modules/observability/schemas/application-log.schema';

export interface ApplicationLogFilters {
  before?: string;
  limit?: string;
  from?: string;
  to?: string;
  level?: string;
  eventType?: string;
  context?: string;
  requestId?: string;
  correlationId?: string;
  batchId?: string;
  jobId?: string;
  queueName?: string;
  search?: string;
}

@Injectable()
export class ApplicationLogQueryService {
  constructor(
    @InjectModel(ApplicationLog.name, 'logs')
    private readonly model: Model<ApplicationLog>,
  ) {}

  async list(filters: ApplicationLogFilters) {
    const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
    const query = this.buildQuery(filters);
    const docs = await this.model
      .find(query)
      .sort({ timestamp: -1, _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();
    const hasMore = docs.length > limit;
    const items = docs.slice(0, limit);
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                timestamp: last.timestamp.toISOString(),
                id: last._id.toString(),
              }),
            ).toString('base64url')
          : null,
    };
  }

  async listOffset(filters: ApplicationLogFiltersDto) {
    const page = Math.max(Number(filters.page) || 1, 1);
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 500);
    const skip = (page - 1) * limit;

    const query = this.buildOffsetQuery(filters);

    // 1. Fetch total items matching query
    const total = await this.model.countDocuments(query).exec();
    const totalPages = Math.ceil(total / limit);

    // 2. Fetch summary counts breakdown (total, error, warn, info) matching the query (ignoring level filter)
    const summaryQuery = { ...query };
    delete summaryQuery.level;

    const levelCounts = await this.model
      .aggregate([
        { $match: summaryQuery },
        { $group: { _id: '$level', count: { $sum: 1 } } },
      ])
      .exec();

    let errorCount = 0;
    let warnCount = 0;
    let infoCount = 0;

    for (const group of levelCounts) {
      if (group._id === 'error') {
        errorCount = group.count;
      } else if (group._id === 'warn' || group._id === 'warning') {
        warnCount = group.count;
      } else if (group._id === 'info') {
        infoCount = group.count;
      }
    }

    // 3. Fetch matched records with pagination and sorting
    const sortByField = filters.sortBy || 'timestamp';
    const sortDir = filters.sortDirection === 'asc' ? 1 : -1;
    const sortObj: Record<string, any> = { [sortByField]: sortDir };
    if (sortByField !== 'timestamp') {
      sortObj.timestamp = -1;
    }
    sortObj._id = -1; // deterministic sorting

    const items = await this.model
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
      summary: {
        total,
        error: errorCount,
        warn: warnCount,
        info: infoCount,
      },
    };
  }

  async get(eventId: string) {
    const doc = await this.model.findOne({ eventId }).lean().exec();
    if (!doc) throw new NotFoundException(`Log event ${eventId} not found`);
    return doc;
  }

  async delete(eventId: string) {
    const result = await this.model.deleteOne({ eventId }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Log event ${eventId} not found`);
    }
    return { status: 'deleted' as const, eventId, deletedCount: 1 };
  }

  /**
   * Delete logs matching the live-feed filters. Empty filters require
   * confirmAll=true so a mistyped request cannot wipe the collection.
   */
  async deleteMatchingLive(
    filters: ApplicationLogFilters,
    confirmAll?: string,
  ) {
    const query = this.buildQuery({
      ...filters,
      before: undefined,
      limit: undefined,
    });
    return this.deleteByQuery(query, confirmAll);
  }

  /**
   * Delete logs matching the explorer filters. Empty filters require
   * confirmAll=true so a mistyped request cannot wipe the collection.
   */
  async deleteMatchingExplorer(
    filters: ApplicationLogFiltersDto,
    confirmAll?: string,
  ) {
    const query = this.buildOffsetQuery(filters);
    return this.deleteByQuery(query, confirmAll);
  }

  private async deleteByQuery(query: Record<string, any>, confirmAll?: string) {
    if (Object.keys(query).length === 0 && confirmAll !== 'true') {
      throw new BadRequestException(
        'Pass confirmAll=true to delete all application logs',
      );
    }
    const result = await this.model.deleteMany(query).exec();
    return {
      status: 'deleted' as const,
      deletedCount: result.deletedCount ?? 0,
    };
  }

  /**
   * Most recent event of a given type, used to inspect the last captured
   * request/response bodies for an integration.
   */
  async getLatestByEventType(eventType: string) {
    return this.model
      .findOne({ eventType })
      .sort({ timestamp: -1, _id: -1 })
      .lean()
      .exec();
  }

  /**
   * Retrieve all application logs and captured request/response bodies for a batch ID or journal number.
   */
  async getLogsByBatchId(batchId: string) {
    const escaped = this.escapeRegex(batchId);
    const query = {
      $or: [
        { batchId },
        { 'metadata.batchId': batchId },
        { correlationId: batchId },
        { jobId: batchId },
        { message: { $regex: escaped, $options: 'i' } },
      ],
    };
    return this.model
      .find(query)
      .sort({ timestamp: 1, _id: 1 })
      .lean()
      .exec();
  }


  private buildQuery(filters: ApplicationLogFilters): Record<string, any> {
    const query: Record<string, any> = {};
    for (const key of [
      'level',
      'eventType',
      'context',
      'requestId',
      'correlationId',
      'batchId',
      'jobId',
      'queueName',
    ] as const) {
      if (filters[key]) query[key] = filters[key];
    }

    if (filters.from || filters.to) {
      query.timestamp = {};
      if (filters.from) query.timestamp.$gte = new Date(filters.from);
      if (filters.to) query.timestamp.$lte = new Date(filters.to);
    }
    if (filters.search) {
      query.message = {
        $regex: this.escapeRegex(filters.search),
        $options: 'i',
      };
    }
    if (filters.before) {
      const cursor = this.decodeCursor(filters.before);
      query.$or = [
        { timestamp: { $lt: cursor.timestamp } },
        {
          timestamp: cursor.timestamp,
          _id: { $lt: cursor.id },
        },
      ];
    }
    return query;
  }

  private buildOffsetQuery(
    filters: ApplicationLogFiltersDto,
  ): Record<string, any> {
    const query: Record<string, any> = {};

    if (filters.level) {
      query.level = filters.level;
    }

    if (filters.from || filters.to) {
      query.timestamp = {};
      if (filters.from) query.timestamp.$gte = new Date(filters.from);
      if (filters.to) query.timestamp.$lte = new Date(filters.to);
    }

    if (filters.search) {
      query.message = {
        $regex: this.escapeRegex(filters.search),
        $options: 'i',
      };
    }

    if (filters.method) {
      query['metadata.method'] = filters.method.toUpperCase();
    }

    if (filters.route) {
      query['metadata.path'] = {
        $regex: this.escapeRegex(filters.route),
        $options: 'i',
      };
    }

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.queue) {
      query.queueName = filters.queue;
    }

    if (filters.jobId) {
      query.jobId = filters.jobId;
    }

    if (filters.batchId) {
      query.batchId = filters.batchId;
    }

    if (filters.requestId) {
      query.requestId = filters.requestId;
    }

    if (filters.eventType) {
      query.eventType = filters.eventType;
    }

    if (filters.context) {
      query.context = filters.context;
    }

    if (filters.hasPayload === 'true') {
      query.payload = { $exists: true, $ne: null };
    }

    return query;
  }

  private decodeCursor(cursor: string): {
    timestamp: Date;
    id: Types.ObjectId;
  } {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { timestamp: string; id: string };
    return {
      timestamp: new Date(parsed.timestamp),
      id: new Types.ObjectId(parsed.id),
    };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
