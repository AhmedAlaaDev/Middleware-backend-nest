import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  ICacheEntryFilters,
  ICacheEntry,
  IUpdateCacheEntry,
} from '@/modules/resilience/interfaces/cache-entry.interface';
import { CacheEntryRepository } from '@/modules/resilience/repositories/interfaces/cache-entry.repository';
import { CacheEntry } from '@/modules/resilience/schemas/cache-entry.schema';

@Injectable()
export class CacheEntryMongoRepository extends CacheEntryRepository {
  constructor(
    @InjectModel(CacheEntry.name)
    private readonly model: Model<CacheEntry>,
  ) {
    super();
  }

  public async deleteMany(key: string): Promise<void> {
    await this.model.deleteMany({ key }).exec();
  }

  public async findOneByKey(
    key: string,
    filters?: Pick<ICacheEntryFilters, 'expiresAt'>,
  ): Promise<ICacheEntry | null> {
    const q: Record<string, unknown> = {
      key,
    };

    if (filters?.expiresAt) {
      q['expiresAt'] = { $gt: filters.expiresAt };
    }

    const entry = await this.model.findOne(q).lean();

    if (!entry) return null;

    return {
      id: entry._id.toString(),
      key: entry.key,
      value: entry.value,
      expiresAt: entry.expiresAt.toISOString(),
    };
  }

  public async findOneById(
    id: string,
    filters?: ICacheEntryFilters,
  ): Promise<ICacheEntry | null> {
    const q: Record<string, unknown> = {
      _id: id,
    };

    if (filters?.expiresAt) {
      q['expiresAt'] = { $gt: filters.expiresAt };
    }

    if (filters?.key) {
      q['key'] = filters.key;
    }

    const entry = await this.model.findOne(q).lean();

    if (!entry) return null;

    return {
      id: entry._id.toString(),
      key: entry.key,
      value: entry.value,
      expiresAt: entry.expiresAt.toISOString(),
    };
  }

  public async upsert(
    key: string,
    payload: IUpdateCacheEntry,
  ): Promise<ICacheEntry> {
    const entry = await this.model
      .findOneAndUpdate(
        { key },
        {
          key,
          value: JSON.stringify(payload.value),
          expiresAt: payload.expiresAt,
        },
        { upsert: true, new: true },
      )
      .lean();

    return {
      id: entry._id.toString(),
      key: entry.key,
      value: entry.value,
      expiresAt: entry.expiresAt.toISOString(),
    };
  }
}
