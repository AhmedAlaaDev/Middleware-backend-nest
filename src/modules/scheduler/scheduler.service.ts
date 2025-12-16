import { Injectable, Logger } from '@nestjs/common';

import { TokenCleanupJob } from '@/modules/scheduler/jobs/token-cleanup.job';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly tokenCleanupJob: TokenCleanupJob) {}

  /**
   * Manually trigger token cleanup
   * Useful for admin operations or testing
   */
  async triggerTokenCleanup(): Promise<{
    expiredDeleted: number;
    revokedDeleted: number;
    totalDeleted: number;
  }> {
    this.logger.log('Triggering manual token cleanup');
    return this.tokenCleanupJob.triggerManualCleanup();
  }

  /**
   * Get scheduler health status
   */
  getHealth(): { status: string; jobs: string[] } {
    return {
      status: 'healthy',
      jobs: ['token-cleanup'],
    };
  }
}
