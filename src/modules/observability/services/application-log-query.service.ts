import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

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

  async get(eventId: string) {
    const doc = await this.model.findOne({ eventId }).lean().exec();
    if (!doc) throw new NotFoundException(`Log event ${eventId} not found`);
    return doc;
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
