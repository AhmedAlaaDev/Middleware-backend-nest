import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IConfig, ResilienceConfig } from '@/config';
import { CacheEntryRepository } from '@/modules/resilience/repositories/interfaces/cache-entry.repository';
import { CacheService } from '@/modules/resilience/services/cache.service';

export interface CacheLayerOptions {
  l1Ttl?: number;
  l2Ttl?: number;
  l3Ttl?: number;
  useL2?: boolean; // Toggle Redis ON/OFF in future
  useL3?: boolean; // Toggle DB caching
}

@Injectable()
export class MultiLayerCacheService {
  private readonly logger = new Logger(MultiLayerCacheService.name);

  private readonly defaultL1Ttl: number;
  private readonly defaultL2Ttl: number;
  private readonly defaultL3Ttl: number;

  constructor(
    private readonly cache: CacheService, // In-memory (now), Redis (future)
    private readonly cacheEntryRepo: CacheEntryRepository,
    private readonly config: ConfigService<IConfig>,
  ) {
    const defaultCacheOptions =
      this.config.get<ResilienceConfig>('resilience')?.cache;

    this.defaultL1Ttl = defaultCacheOptions?.l1Ttl ?? 5 * 60 * 1000;
    this.defaultL2Ttl = defaultCacheOptions?.l2Ttl ?? 30 * 60 * 1000;
    this.defaultL3Ttl = defaultCacheOptions?.l3Ttl ?? 2 * 60 * 60 * 1000;
  }

  /**
   * PUBLIC GET
   */
  async get<T>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheLayerOptions,
  ): Promise<T> {
    const opts = this.mergeOptions(options);

    // 1️⃣ Try L1
    const l1Value = await this.getL1<T>(key);
    if (l1Value !== undefined) {
      this.logger.debug(`L1 HIT: ${key}`);
      return l1Value;
    }

    // 2️⃣ Try L2 (if Redis enabled)
    if (opts.useL2) {
      const l2Value = await this.getL2<T>(key);
      if (l2Value !== undefined) {
        this.logger.debug(`L2 HIT: ${key}`);
        await this.setL1(key, l2Value, opts.l1Ttl);
        return l2Value;
      }
    }

    // 3️⃣ Try L3 (DB)
    if (opts.useL3) {
      const l3Value = await this.getL3<T>(key);
      if (l3Value !== undefined) {
        this.logger.debug(`L3 HIT: ${key}`);
        await this.promoteToUpperLayers(key, l3Value, opts);
        return l3Value;
      }
    }

    // ❌ Cache MISS → fetch from source
    this.logger.debug(`CACHE MISS: ${key}`);
    const value = await factory();

    await this.setAllLayers(key, value, opts);

    return value;
  }

  /**
   * DELETE
   */
  async delete(key: string): Promise<void> {
    await this.cache.del(`l1:${key}`).catch(() => {});
    await this.cache.del(`l2:${key}`).catch(() => {});
    await this.cacheEntryRepo.deleteMany(`l3:${key}`);
  }

  // ----------------------------------------
  // PRIVATE LAYER HANDLERS
  // ----------------------------------------

  private async getL1<T>(key: string) {
    return this.cache.get<T>(`l1:${key}`);
  }

  private async getL2<T>(key: string) {
    return this.cache.get<T>(`l2:${key}`);
  }

  private async getL3<T>(key: string) {
    const entry = await this.cacheEntryRepo.findOneByKey(key, {
      expiresAt: new Date(),
    });
    return entry ? (JSON.parse(entry.value) as T) : undefined;
  }

  private async setL1<T>(key: string, value: T, ttl: number) {
    return this.cache.set(`l1:${key}`, value, ttl);
  }

  private async setL2<T>(key: string, value: T, ttl: number) {
    return this.cache.set(`l2:${key}`, value, ttl);
  }

  private async setL3<T>(key: string, value: T, ttl: number) {
    const expiresAt = new Date(Date.now() + ttl);
    await this.cacheEntryRepo.upsert(`l3:${key}`, {
      key: `l3:${key}`,
      value: JSON.stringify(value),
      expiresAt,
    });
  }

  private async promoteToUpperLayers<T>(
    key: string,
    value: T,
    opts: CacheLayerOptions,
  ) {
    await this.setL1(key, value, opts.l1Ttl!);
    if (opts.useL2) await this.setL2(key, value, opts.l2Ttl!);
  }

  private async setAllLayers<T>(
    key: string,
    value: T,
    opts: CacheLayerOptions,
  ): Promise<void> {
    const tasks: Promise<any>[] = [];

    // Always set L1
    tasks.push(this.setL1(key, value, opts.l1Ttl!));

    // Set L2 only if enabled
    if (opts.useL2) {
      tasks.push(this.setL2(key, value, opts.l2Ttl!));
    }

    // Set L3 only if enabled
    if (opts.useL3) {
      tasks.push(this.setL3(key, value, opts.l3Ttl!));
    }

    await Promise.all(tasks);
  }

  private mergeOptions(options?: CacheLayerOptions) {
    return {
      l1Ttl: options?.l1Ttl ?? this.defaultL1Ttl,
      l2Ttl: options?.l2Ttl ?? this.defaultL2Ttl,
      l3Ttl: options?.l3Ttl ?? this.defaultL3Ttl,
      useL2: options?.useL2 ?? true, // Redis support ready
      useL3: options?.useL3 ?? true,
    };
  }
}
