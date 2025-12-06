import KeyvRedis from '@keyv/redis';
import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheableMemory } from 'cacheable';
import { Keyv } from 'keyv';

import { IConfig, RedisConfig } from '@/config';
import { CacheEntryMongoRepository } from '@/modules/resilience/repositories/cache-entry.mongo.repository';
import { CacheEntryRepository } from '@/modules/resilience/repositories/interfaces/cache-entry.repository';
import {
  CacheEntry,
  CacheEntrySchema,
} from '@/modules/resilience/schemas/cache-entry.schema';
import { CacheService } from '@/modules/resilience/services/cache.service';
import { CircuitBreakerService } from '@/modules/resilience/services/circuit-breaker.service';
import { MultiLayerCacheService } from '@/modules/resilience/services/mutli-layer-cache.service';
import { RetryService } from '@/modules/resilience/services/retry.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CacheEntry.name, schema: CacheEntrySchema },
    ]),
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<IConfig>) => {
        const redis = cfg.get<RedisConfig>('redis');

        if (!redis) throw new Error('Redis Config is missing!');

        const redisUri = redis.password
          ? `redis://${encodeURIComponent(redis.password)}@${redis.host}:${redis.port}`
          : `redis://${redis.host}:${redis.port}`;

        return {
          stores: [
            // -------------------------
            // L1 — In-memory cache
            // -------------------------
            new Keyv({
              store: new CacheableMemory({
                ttl: 60_000, // default in-memory TTL
                lruSize: 5000, // LRU eviction
              }),
            }),

            // -------------------------
            // L2 — Redis cache
            // -------------------------
            new Keyv({
              store: new KeyvRedis(redisUri),
            }),
          ],
        };
      },
    }),
    HttpModule.register({
      global: true,
      timeout: 120000, // 120 seconds default, configurable via HTTP_TIMEOUT env var
      maxRedirects: 5, // 5 redirects
    }),
  ],
  providers: [
    CircuitBreakerService,
    RetryService,
    CacheService,
    MultiLayerCacheService,
    { provide: CacheEntryRepository, useClass: CacheEntryMongoRepository },
  ],
  exports: [
    CircuitBreakerService,
    RetryService,
    CacheService,
    MultiLayerCacheService,
  ],
})
export class ResilienceModule {}
