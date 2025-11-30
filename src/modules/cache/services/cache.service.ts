import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class CacheService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async get<T>(key: string): Promise<T | undefined> {
    return this.cacheManager.get<T>(key);
  }

  async set<T>(
    key: string,
    value: T,
    ttl?: number,
  ): Promise<void> {
    await this.cacheManager.set(key, value, ttl);
  }

  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }

  async reset(): Promise<void> {
    await this.cacheManager.reset();
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }

  async getByPattern(pattern: string): Promise<Array<{ key: string; value: any }>> {
    // This depends on the cache store implementation
    // Redis supports pattern matching, MemoryCache doesn't
    // For now, return empty array - should be implemented based on store
    return [];
  }

  async deleteByPattern(pattern: string): Promise<void> {
    // Pattern-based deletion - implementation depends on cache store
    // Redis supports this, MemoryCache doesn't
  }
}

