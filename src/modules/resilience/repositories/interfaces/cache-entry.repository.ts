import {
  ICacheEntry,
  ICacheEntryFilters,
  IUpdateCacheEntry,
} from '@/modules/resilience/interfaces/cache-entry.interface';

export abstract class CacheEntryRepository {
  abstract deleteMany(key: string): Promise<void>;

  abstract findOneById(
    id: string,
    filters?: ICacheEntryFilters,
  ): Promise<ICacheEntry | null>;

  abstract findOneByKey(
    key: string,
    filters?: Pick<ICacheEntryFilters, 'expiresAt'>,
  ): Promise<ICacheEntry | null>;

  abstract upsert(
    key: string,
    payload: IUpdateCacheEntry,
  ): Promise<ICacheEntry>;
}
