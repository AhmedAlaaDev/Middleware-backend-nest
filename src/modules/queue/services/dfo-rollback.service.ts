import { Logger } from '@nestjs/common';

import { IDfoPostingStrategy } from '../strategies/dfo-posting-strategy.interface';

import { PostingErrorCollector } from './posting-error-collector.service';

/**
 * Result of rollback operation
 */
export interface RollbackResult {
  successfullyDeletedHeaders: string[];
  failedToDeleteHeaders: string[];
  successfullyDeletedLines: Array<{ headerId: string; lineNumber: number }>;
  failedToDeleteLines: Array<{
    headerId: string;
    lineNumber: number;
    error: string;
  }>;
}

/**
 * Service for handling rollback operations when posting fails
 * Handles deletion of headers and lines in chunks
 */
export class DfoRollbackService {
  private readonly logger = new Logger(DfoRollbackService.name);

  /**
   * Rollback headers by deleting them in chunks
   * @param strategy The posting strategy to use for deletion
   * @param headerIds Array of header IDs to delete
   * @param dataAreaId The company data area ID
   * @param chunkSize Number of headers to delete per chunk
   * @param errorCollector Error collector to record rollback errors
   * @returns Result indicating which headers were successfully deleted
   */
  public async rollbackHeaders(
    strategy: IDfoPostingStrategy,
    headerIds: string[],
    dataAreaId: string,
    chunkSize: number,
    errorCollector: PostingErrorCollector,
  ): Promise<{
    successfullyDeleted: string[];
    failedToDelete: string[];
  }> {
    if (headerIds.length === 0) {
      return { successfullyDeleted: [], failedToDelete: [] };
    }

    this.logger.log(
      `Starting rollback: deleting ${headerIds.length} headers in chunks of ${chunkSize}`,
    );

    const successfullyDeleted: string[] = [];
    const failedToDelete: string[] = [];

    // Process in chunks
    for (let i = 0; i < headerIds.length; i += chunkSize) {
      const chunk = headerIds.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(headerIds.length / chunkSize);

      this.logger.debug(
        `Deleting headers chunk ${chunkNumber} of ${totalChunks} (${chunk.length} headers)`,
      );

      // Delete headers in parallel within chunk
      const deletePromises = chunk.map(async (headerId) => {
        try {
          await strategy.deleteHeader(headerId, dataAreaId);
          successfullyDeleted.push(headerId);
          this.logger.debug(
            `Successfully deleted header ${headerId} during rollback`,
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to delete header ${headerId} during rollback: ${errorMessage}`,
          );
          failedToDelete.push(headerId);
          errorCollector.addRollbackError(
            `Failed to delete header: ${errorMessage}`,
            `Header deletion chunk ${chunkNumber}`,
            headerId,
          );
        }
      });

      await Promise.all(deletePromises);
    }

    this.logger.log(
      `Rollback completed: ${successfullyDeleted.length} headers deleted, ${failedToDelete.length} failed`,
    );

    return { successfullyDeleted, failedToDelete };
  }

  /**
   * Rollback lines by deleting them in chunks
   * @param strategy The posting strategy to use for deletion
   * @param lines Array of line identifiers to delete
   * @param dataAreaId The company data area ID
   * @param chunkSize Number of lines to delete per chunk
   * @param errorCollector Error collector to record rollback errors
   * @returns Result indicating which lines were successfully deleted
   */
  public async rollbackLines(
    strategy: IDfoPostingStrategy,
    lines: Array<{ headerId: string; lineNumber: number }>,
    dataAreaId: string,
    chunkSize: number,
    errorCollector: PostingErrorCollector,
  ): Promise<{
    successfullyDeleted: Array<{ headerId: string; lineNumber: number }>;
    failedToDelete: Array<{
      headerId: string;
      lineNumber: number;
      error: string;
    }>;
  }> {
    if (lines.length === 0) {
      return { successfullyDeleted: [], failedToDelete: [] };
    }

    this.logger.log(
      `Starting line rollback: deleting ${lines.length} lines in chunks of ${chunkSize}`,
    );

    const deleteResult = await strategy.deleteLinesInBatches(
      lines,
      dataAreaId,
      chunkSize,
    );

    // Record failed deletions in error collector
    for (const failed of deleteResult.failed) {
      errorCollector.addRollbackError(
        `Failed to delete line: ${failed.error}`,
        'Line deletion rollback',
        failed.headerId,
        failed.lineNumber,
      );
    }

    this.logger.log(
      `Line rollback completed: ${deleteResult.successful.length} lines deleted, ${deleteResult.failed.length} failed`,
    );

    return {
      successfullyDeleted: deleteResult.successful,
      failedToDelete: deleteResult.failed,
    };
  }

  /**
   * Rollback both lines and headers
   * First attempts to delete lines, then deletes headers
   * @param strategy The posting strategy to use for deletion
   * @param headerIds Array of header IDs to delete
   * @param lines Array of line identifiers to delete (optional)
   * @param dataAreaId The company data area ID
   * @param chunkSize Number of items to delete per chunk
   * @param errorCollector Error collector to record rollback errors
   * @returns Complete rollback result
   */
  public async rollbackWithLines(
    strategy: IDfoPostingStrategy,
    headerIds: string[],
    lines: Array<{ headerId: string; lineNumber: number }> | null,
    dataAreaId: string,
    chunkSize: number,
    errorCollector: PostingErrorCollector,
  ): Promise<RollbackResult> {
    const result: RollbackResult = {
      successfullyDeletedHeaders: [],
      failedToDeleteHeaders: [],
      successfullyDeletedLines: [],
      failedToDeleteLines: [],
    };

    // First, try to delete lines if they exist
    if (lines && lines.length > 0) {
      this.logger.log(
        `Rolling back ${lines.length} lines before deleting headers`,
      );
      const lineResult = await this.rollbackLines(
        strategy,
        lines,
        dataAreaId,
        chunkSize,
        errorCollector,
      );
      result.successfullyDeletedLines = lineResult.successfullyDeleted;
      result.failedToDeleteLines = lineResult.failedToDelete;
    }

    // Then delete headers
    if (headerIds.length > 0) {
      this.logger.log(
        `Rolling back ${headerIds.length} headers after line deletion`,
      );
      const headerResult = await this.rollbackHeaders(
        strategy,
        headerIds,
        dataAreaId,
        chunkSize,
        errorCollector,
      );
      result.successfullyDeletedHeaders = headerResult.successfullyDeleted;
      result.failedToDeleteHeaders = headerResult.failedToDelete;
    }

    return result;
  }
}
