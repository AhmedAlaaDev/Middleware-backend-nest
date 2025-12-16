import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { IConfig, SchedulerConfig } from '@/config';
import { SessionService } from '@/modules/auth/services/session.service';

@Injectable()
export class TokenCleanupJob {
  private readonly logger = new Logger(TokenCleanupJob.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly cfg: ConfigService<IConfig>,
  ) {}

  /**
   * Scheduled job to clean up expired and old revoked tokens
   * Runs based on configuration (default: daily at midnight)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'token-cleanup',
    timeZone: 'UTC',
  })
  async handleTokenCleanup(): Promise<void> {
    const config = this.cfg.get<SchedulerConfig>('scheduler');

    if (!config?.enabled) {
      this.logger.debug('Scheduler disabled, skipping token cleanup');
      return;
    }

    const startTime = Date.now();
    this.logger.log('Starting token cleanup job...');

    try {
      // Get statistics before cleanup
      const statsBefore = await this.sessionService.getTokenStatistics();
      this.logger.log(
        `Tokens before cleanup: Total=${statsBefore.total}, Active=${statsBefore.active}, Revoked=${statsBefore.revoked}, Expired=${statsBefore.expired}`,
      );

      // Clean up expired tokens
      const expiredDeleted = await this.sessionService.cleanupExpiredTokens();
      this.logger.log(`Deleted ${expiredDeleted} expired tokens`);

      // Clean up old revoked tokens
      const retentionDays = config?.tokenCleanupRetentionDays || 30;
      const revokedDeleted =
        await this.sessionService.cleanupOldRevokedTokens(retentionDays);
      this.logger.log(
        `Deleted ${revokedDeleted} revoked tokens older than ${retentionDays} days`,
      );

      // Get statistics after cleanup
      const statsAfter = await this.sessionService.getTokenStatistics();
      const totalDeleted = expiredDeleted + revokedDeleted;
      const duration = Date.now() - startTime;

      this.logger.log(
        `Token cleanup completed successfully. Deleted ${totalDeleted} tokens in ${duration}ms`,
      );
      this.logger.log(
        `Tokens after cleanup: Total=${statsAfter.total}, Active=${statsAfter.active}`,
      );
    } catch (error) {
      this.logger.error(
        'Token cleanup job failed',
        error instanceof Error ? error.stack : String(error),
      );
      // Don't throw - we don't want to break the scheduler
    }
  }

  /**
   * Manual trigger for testing or admin operations
   */
  async triggerManualCleanup(): Promise<{
    expiredDeleted: number;
    revokedDeleted: number;
    totalDeleted: number;
  }> {
    this.logger.log('Manual token cleanup triggered');

    const config = this.cfg.get<SchedulerConfig>('scheduler');
    const retentionDays = config?.tokenCleanupRetentionDays || 30;

    const [expiredDeleted, revokedDeleted] = await Promise.all([
      this.sessionService.cleanupExpiredTokens(),
      this.sessionService.cleanupOldRevokedTokens(retentionDays),
    ]);

    const totalDeleted = expiredDeleted + revokedDeleted;
    this.logger.log(`Manual cleanup completed: ${totalDeleted} tokens deleted`);

    return { expiredDeleted, revokedDeleted, totalDeleted };
  }
}
