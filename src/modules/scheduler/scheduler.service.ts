import { Injectable, Logger } from '@nestjs/common';

import { TempFileCleanupJob } from '@/modules/scheduler/jobs/temp-file-cleanup.job';
import { TokenCleanupJob } from '@/modules/scheduler/jobs/token-cleanup.job';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly tokenCleanupJob: TokenCleanupJob,
    private readonly tempFileCleanupJob: TempFileCleanupJob,
  ) {}

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
   * Manually trigger temp file cleanup
   * Useful for admin operations or testing
   */
  async triggerTempFileCleanup(): Promise<{
    deletedCount: number;
    totalSize: number;
    filesChecked: number;
  }> {
    this.logger.log('Triggering manual temp file cleanup');
    return this.tempFileCleanupJob.triggerManualCleanup();
  }

  /**
   * Get scheduler health status
   */
  getHealth(): { status: string; jobs: string[] } {
    return {
      status: 'healthy',
      jobs: ['token-cleanup', 'temp-file-cleanup'],
    };
  }
}
