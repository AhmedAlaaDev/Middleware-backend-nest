import { Module, Global } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { CacheService } from './services/cache.service';
import { MultiLayerCacheService } from './services/multi-layer-cache.service';

@Global()
@Module({
  imports: [NestCacheModule],
  providers: [CacheService, MultiLayerCacheService],
  exports: [CacheService, MultiLayerCacheService],
})
export class CacheModule {}

