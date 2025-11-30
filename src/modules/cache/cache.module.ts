import { Module, Global } from '@nestjs/common';
import { CacheService } from './services/cache.service';
import { MultiLayerCacheService } from './services/multi-layer-cache.service';

@Global()
@Module({
  // CacheModule is already registered globally in app.module.ts
  // No need to import NestCacheModule here as it would create a separate instance
  providers: [CacheService, MultiLayerCacheService],
  exports: [CacheService, MultiLayerCacheService],
})
export class CacheModule {}

