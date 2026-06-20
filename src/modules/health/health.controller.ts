import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Connection } from 'mongoose';

import { Public } from '@/modules/auth/decorators/public.decorator';
import { LogStreamService } from '@/modules/observability/services/log-stream.service';

@ApiBearerAuth()
@Controller('health')
@Public()
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongo: Connection,
    private readonly redis: LogStreamService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const [redis] = await Promise.all([
      this.redis.ping(),
      this.mongo.db?.admin().ping(),
    ]).catch((error) => {
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : 'Dependency unavailable',
      );
    });

    return {
      status: 'ready',
      redis,
      mongo: 'PONG',
    };
  }
}
