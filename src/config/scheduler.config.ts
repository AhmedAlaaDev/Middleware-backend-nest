import { registerAs } from '@nestjs/config';

export interface SchedulerConfig {
  enabled: boolean;
  tokenCleanupCron: string;
  tokenCleanupRetentionDays: number;
}

export const schedulerConfig = registerAs(
  'scheduler',
  (): SchedulerConfig => ({
    // Enable/disable all scheduled jobs
    enabled: process.env.SCHEDULER_ENABLED !== 'false',

    // Cron expression for token cleanup (default: every day at midnight)
    // Format: second minute hour day month weekday
    tokenCleanupCron: process.env.TOKEN_CLEANUP_CRON || '0 0 * * *', // Midnight daily

    // How many days to keep revoked tokens before deletion
    tokenCleanupRetentionDays: parseInt(
      process.env.TOKEN_CLEANUP_RETENTION_DAYS || '30',
      10,
    ),
  }),
);
