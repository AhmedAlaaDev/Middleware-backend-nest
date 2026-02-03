import { promises as fs } from 'fs';
import { join } from 'path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { IConfig, SchedulerConfig } from '@/config';

@Injectable()
export class TempFileCleanupJob {
  private readonly logger = new Logger(TempFileCleanupJob.name);

  constructor(private readonly cfg: ConfigService<IConfig>) {}

  /**
   * Scheduled job to clean up old temporary files created by Excel service
   * Runs every hour based on configuration
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: 'temp-file-cleanup',
    timeZone: 'UTC',
  })
  async handleTempFileCleanup(): Promise<void> {
    const config = this.cfg.get<SchedulerConfig>('scheduler');

    this.logger.debug('config', config);

    if (!config?.enabled) {
      this.logger.debug('Scheduler disabled, skipping temp file cleanup');
      return;
    }

    const startTime = Date.now();
    this.logger.log('Starting temp file cleanup job...');

    try {
      const tempDir = join(process.cwd(), 'temp');
      const retentionHours = config?.tempFileCleanupRetentionHours || 24;

      // Check if temp directory exists
      try {
        await fs.access(tempDir);
      } catch {
        this.logger.debug(`Temp directory does not exist: ${tempDir}`);
        return;
      }

      // Read all files in temp directory
      const files = await fs.readdir(tempDir);
      const now = Date.now();
      const retentionMs = retentionHours * 60 * 60 * 1000;
      let deletedCount = 0;
      let totalSize = 0;

      for (const file of files) {
        const filePath = join(tempDir, file);

        try {
          const stats = await fs.stat(filePath);

          // Only process files (not directories)
          if (!stats.isFile()) {
            continue;
          }

          // Check if file is older than retention period
          const fileAge = now - stats.mtimeMs;
          if (fileAge > retentionMs) {
            const fileSize = stats.size;
            await fs.unlink(filePath);
            deletedCount++;
            totalSize += fileSize;
            this.logger.debug(
              `Deleted old temp file: ${file} (age: ${Math.round(fileAge / (60 * 60 * 1000))}h, size: ${fileSize} bytes)`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Failed to process file ${file}: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Continue with other files
        }
      }

      const duration = Date.now() - startTime;
      const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);

      if (deletedCount > 0) {
        this.logger.log(
          `Temp file cleanup completed successfully. Deleted ${deletedCount} files (${sizeInMB} MB) in ${duration}ms`,
        );
      } else {
        this.logger.debug(
          `Temp file cleanup completed. No files to delete (checked ${files.length} files)`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Temp file cleanup job failed',
        error instanceof Error ? error.stack : String(error),
      );
      // Don't throw - we don't want to break the scheduler
    }
  }

  /**
   * Manual trigger for testing or admin operations
   */
  async triggerManualCleanup(): Promise<{
    deletedCount: number;
    totalSize: number;
    filesChecked: number;
  }> {
    this.logger.log('Manual temp file cleanup triggered');

    const config = this.cfg.get<SchedulerConfig>('scheduler');
    const retentionHours = config?.tempFileCleanupRetentionHours || 24;

    const tempDir = join(process.cwd(), 'temp');
    let filesChecked = 0;
    let deletedCount = 0;
    let totalSize = 0;

    try {
      // Check if temp directory exists
      try {
        await fs.access(tempDir);
      } catch {
        this.logger.debug(`Temp directory does not exist: ${tempDir}`);
        return { deletedCount: 0, totalSize: 0, filesChecked: 0 };
      }

      const files = await fs.readdir(tempDir);
      filesChecked = files.length;
      const now = Date.now();
      const retentionMs = retentionHours * 60 * 60 * 1000;

      for (const file of files) {
        const filePath = join(tempDir, file);

        try {
          const stats = await fs.stat(filePath);

          if (!stats.isFile()) {
            continue;
          }

          const fileAge = now - stats.mtimeMs;
          if (fileAge > retentionMs) {
            const fileSize = stats.size;
            await fs.unlink(filePath);
            deletedCount++;
            totalSize += fileSize;
          }
        } catch (error) {
          this.logger.warn(
            `Failed to process file ${file}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
      this.logger.log(
        `Manual cleanup completed: ${deletedCount} files deleted (${sizeInMB} MB)`,
      );

      return { deletedCount, totalSize, filesChecked };
    } catch (error) {
      this.logger.error(
        'Manual temp file cleanup failed',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
