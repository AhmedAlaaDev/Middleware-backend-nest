import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';

import { CacheService } from '@/modules/resilience/services/cache.service';
import { CircuitBreakerService } from '@/modules/resilience/services/circuit-breaker.service';
import { MultiLayerCacheService } from '@/modules/resilience/services/mutli-layer-cache.service';
import { RetryService } from '@/modules/resilience/services/retry.service';

@Global()
@Module({
  imports: [
    CacheModule.register({
      isGlobal: true,
      ttl: 60 * 60 * 1000, // 1 hour
      max: 100, // 100 items
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
  ],
  exports: [
    CircuitBreakerService,
    RetryService,
    CacheService,
    MultiLayerCacheService,
  ],
})
export class ResilienceModule { }
