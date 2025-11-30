import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { PrismaService } from '../../database/services/prisma.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

/**
 * Multi-layer cache service implementing:
 * L1: In-Memory Cache (MemoryCache) - Hot data, 5 min TTL
 * L2: Distributed Cache (Redis) - Warm data, 30 min TTL
 * L3: Database Cache - Cold data, 2 hour TTL
 */
@Injectable()
export class MultiLayerCacheService {
  private readonly logger = new Logger(MultiLayerCacheService.name);
  private readonly l1Ttl: number;
  private readonly l2Ttl: number;
  private readonly l3Ttl: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly l1Cache: Cache, // MemoryCache
    @Inject(CACHE_MANAGER) private readonly l2Cache: Cache, // Redis (same instance, different keys)
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.l1Ttl = this.configService.get<number>('cache.l1Ttl', 300) * 1000; // 5 minutes
    this.l2Ttl = this.configService.get<number>('cache.l2Ttl', 1800) * 1000; // 30 minutes
    this.l3Ttl = this.configService.get<number>('cache.l3Ttl', 7200) * 1000; // 2 hours
  }

  /**
   * Get value from cache using multi-layer strategy
   * Tries L1 -> L2 -> L3 -> Source
   */
  async get<T>(
    key: string,
    sourceFactory: () => Promise<T>,
    options?: {
      l1Ttl?: number;
      l2Ttl?: number;
      l3Ttl?: number;
      skipL1?: boolean;
      skipL2?: boolean;
      skipL3?: boolean;
    },
  ): Promise<T> {
    const l1Key = `l1:${key}`;
    const l2Key = `l2:${key}`;
    const l3Key = `l3:${key}`;

    // Try L1 (MemoryCache) - fastest
    if (!options?.skipL1) {
      try {
        const l1Value = await this.l1Cache.get<T>(l1Key);
        if (l1Value !== undefined && l1Value !== null) {
          this.logger.debug(`Cache hit L1: ${key}`);
          return l1Value;
        }
      } catch (error) {
        this.logger.warn(`L1 cache error for key ${key}:`, error);
      }
    }

    // Try L2 (Redis) - fast
    if (!options?.skipL2) {
      try {
        const l2Value = await this.l2Cache.get<T>(l2Key);
        if (l2Value !== undefined && l2Value !== null) {
          this.logger.debug(`Cache hit L2: ${key}`);
          // Promote to L1
          await this.l1Cache.set(
            l1Key,
            l2Value,
            options?.l1Ttl || this.l1Ttl,
          );
          return l2Value;
        }
      } catch (error) {
        this.logger.warn(`L2 cache error for key ${key}:`, error);
      }
    }

    // Try L3 (Database cache table) - slower
    if (!options?.skipL3) {
      try {
        const l3Value = await this.getFromL3<T>(l3Key);
        if (l3Value !== undefined && l3Value !== null) {
          this.logger.debug(`Cache hit L3: ${key}`);
          // Promote to L2 and L1
          await this.l2Cache.set(
            l2Key,
            l3Value,
            options?.l2Ttl || this.l2Ttl,
          );
          await this.l1Cache.set(
            l1Key,
            l3Value,
            options?.l1Ttl || this.l1Ttl,
          );
          return l3Value;
        }
      } catch (error) {
        this.logger.warn(`L3 cache error for key ${key}:`, error);
      }
    }

    // Cache miss - fetch from source
    this.logger.debug(`Cache miss: ${key}, fetching from source`);
    const value = await sourceFactory();

    // Store in all layers
    await Promise.all([
      this.l1Cache.set(l1Key, value, options?.l1Ttl || this.l1Ttl),
      this.l2Cache.set(l2Key, value, options?.l2Ttl || this.l2Ttl),
      this.setL3(l3Key, value, options?.l3Ttl || this.l3Ttl),
    ]);

    return value;
  }

  /**
   * Set value in all cache layers
   */
  async set<T>(
    key: string,
    value: T,
    options?: {
      l1Ttl?: number;
      l2Ttl?: number;
      l3Ttl?: number;
    },
  ): Promise<void> {
    const l1Key = `l1:${key}`;
    const l2Key = `l2:${key}`;
    const l3Key = `l3:${key}`;

    await Promise.all([
      this.l1Cache.set(l1Key, value, options?.l1Ttl || this.l1Ttl),
      this.l2Cache.set(l2Key, value, options?.l2Ttl || this.l2Ttl),
      this.setL3(l3Key, value, options?.l3Ttl || this.l3Ttl),
    ]);
  }

  /**
   * Delete from all cache layers
   */
  async delete(key: string): Promise<void> {
    const l1Key = `l1:${key}`;
    const l2Key = `l2:${key}`;
    const l3Key = `l3:${key}`;

    await Promise.all([
      this.l1Cache.del(l1Key).catch(() => {}),
      this.l2Cache.del(l2Key).catch(() => {}),
      this.deleteL3(l3Key).catch(() => {}),
    ]);
  }

  /**
   * Invalidate cache by pattern (affects all layers)
   */
  async invalidatePattern(pattern: string): Promise<void> {
    // Implementation would depend on cache store capabilities
    // Redis supports pattern matching
    this.logger.warn(`Pattern invalidation not fully implemented for: ${pattern}`);
  }

  /**
   * Warm up cache (preload frequently used data)
   */
  async warmUp(keys: Array<{ key: string; factory: () => Promise<any> }>): Promise<void> {
    this.logger.log(`Warming up cache with ${keys.length} items`);
    await Promise.all(
      keys.map(({ key, factory }) => this.get(key, factory, { skipL3: true })),
    );
  }

  private async getFromL3<T>(key: string): Promise<T | null> {
    // L3 cache stored in PostgreSQL table using Prisma
    const cacheEntry = await this.prismaService.cacheEntry.findFirst({
      where: {
        key,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!cacheEntry) {
      return null;
    }

    return JSON.parse(cacheEntry.value) as T;
  }

  private async setL3<T>(key: string, value: T, ttl: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttl);
    const serializedValue = JSON.stringify(value);

    await this.prismaService.cacheEntry.upsert({
      where: { key },
      update: {
        value: serializedValue,
        expiresAt,
      },
      create: {
        key,
        value: serializedValue,
        expiresAt,
      },
    });
  }

  private async deleteL3(key: string): Promise<void> {
    await this.prismaService.cacheEntry.deleteMany({
      where: { key },
    });
  }
}

