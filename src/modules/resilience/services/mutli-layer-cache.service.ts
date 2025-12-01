import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MultiLayerCacheService {
  private readonly logger = new Logger(MultiLayerCacheService.name);
}
