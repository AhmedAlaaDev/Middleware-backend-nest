import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Injectable, Inject } from '@nestjs/common';

@Injectable()
export class CacheService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async get<T>(key: string): Promise<T | undefined> {
    return this.cache.get<T>(key);
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<T> {
    return this.cache.set(key, value, ttl);
  }

  async del(key: string): Promise<boolean> {
    return this.cache.del(key);
  }

  async reset(): Promise<boolean> {
    return this.cache.clear();
  }
}
