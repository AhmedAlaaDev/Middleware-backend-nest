import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequireApiKey } from '@/modules/auth/decorators/api-key.decorator';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { SchedulerService } from '@/modules/scheduler/scheduler.service';

@ApiTags('Scheduler (Admin/Automation)')
@Controller('scheduler')
@Public() // Bypass JWT authentication
@RequireApiKey() // Require API key instead
@ApiHeader({
  name: 'X-API-Key',
  description: 'Admin API key for authentication',
  required: true,
  schema: {
    type: 'string',
    example: 'your-super-secret-api-key-here',
  },
})
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Post('cleanup-tokens')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually trigger token cleanup job',
    description:
      'Triggers immediate cleanup of expired and old revoked refresh tokens. ' +
      'This is useful for testing or when you need to free up database space immediately. ' +
      'Requires admin API key authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'Token cleanup completed successfully',
    schema: {
      type: 'object',
      properties: {
        expiredDeleted: {
          type: 'number',
          description: 'Number of expired tokens deleted',
          example: 15,
        },
        revokedDeleted: {
          type: 'number',
          description: 'Number of old revoked tokens deleted',
          example: 42,
        },
        totalDeleted: {
          type: 'number',
          description: 'Total number of tokens deleted',
          example: 57,
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing API key',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Invalid API Key' },
      },
    },
  })
  async triggerTokenCleanup(): Promise<{
    expiredDeleted: number;
    revokedDeleted: number;
    totalDeleted: number;
  }> {
    return this.schedulerService.triggerTokenCleanup();
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get scheduler health status',
    description:
      'Returns the health status and list of registered scheduled jobs. ' +
      'Useful for monitoring and ensuring the scheduler is running properly.',
  })
  @ApiResponse({
    status: 200,
    description: 'Scheduler health retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        jobs: {
          type: 'array',
          items: { type: 'string' },
          example: ['token-cleanup'],
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing API key',
  })
  getHealth(): { status: string; jobs: string[] } {
    return this.schedulerService.getHealth();
  }
}
