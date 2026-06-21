import { Injectable, Logger } from '@nestjs/common';

import { IDfoPostingStrategy } from '../strategies/dfo-posting-strategy.interface';

import { PostingErrorCollector } from './posting-error-collector.service';

import {
  dfoErrorMessage,
  isDfoDependentLinesError,
} from '@/modules/d365fo/errors/dfo-api.error';

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
 * Metadata for a created header during posting
 */
export interface CreatedHeader {
  headerKey: string; // JournalBatchNumber
  dataAreaId: string;
}

/**
 * Service for handling rollback operations when posting fails
 * Handles deletion of headers and lines in chunks
 */
@Injectable()
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
      `[ROLLBACK] Starting header rollback: ${headerIds.length} headers in chunks of ${chunkSize}`,
    );

    const successfullyDeleted: string[] = [];
    const failedToDelete: string[] = [];

    // Process in chunks
    for (let i = 0; i < headerIds.length; i += chunkSize) {
      const chunk = headerIds.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(headerIds.length / chunkSize);

      this.logger.debug(
        `[ROLLBACK] Deleting headers chunk ${chunkNumber} of ${totalChunks} (${chunk.length} headers)`,
      );

      // Delete headers in parallel within chunk
      const deletePromises = chunk.map(async (headerId) => {
        try {
          await strategy.deleteHeader(headerId, dataAreaId);
          successfullyDeleted.push(headerId);
        } catch (error) {
          const errorMessage = dfoErrorMessage(error);
          this.logger.error(
            `[ROLLBACK] Failed to delete header ${headerId}: ${errorMessage}`,
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
      `[ROLLBACK] Starting line rollback: ${lines.length} lines in chunks of ${chunkSize}`,
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
        `[ROLLBACK] Rolling back ${lines.length} lines before deleting headers`,
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
        `[ROLLBACK] Rolling back ${headerIds.length} headers after line deletion`,
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

  /**
   * Rollback all created headers in reverse order with lines-first guarantee
   * This method ensures atomic rollback by:
   * 1. Processing headers in reverse creation order (last to first)
   * 2. For each header: query lines from D365FO, delete all lines, then delete header
   * 3. If header deletion fails with "dependent lines exist", query and delete remaining lines, then retry
   * 4. Handles partial success - queries D365FO for existing lines rather than assuming
   *
   * @param strategy The posting strategy to use for deletion and querying
   * @param createdHeaders Array of created headers with metadata (in creation order)
   * @param chunkSize Number of lines to delete per chunk
   * @param errorCollector Error collector to record rollback errors
   * @returns Complete rollback result with per-header details
   */
  public async rollbackAll(
    strategy: IDfoPostingStrategy,
    createdHeaders: CreatedHeader[],
    chunkSize: number,
    errorCollector: PostingErrorCollector,
  ): Promise<RollbackResult> {
    if (createdHeaders.length === 0) {
      this.logger.log('[ROLLBACK] No headers to rollback');
      return {
        successfullyDeletedHeaders: [],
        failedToDeleteHeaders: [],
        successfullyDeletedLines: [],
        failedToDeleteLines: [],
      };
    }

    this.logger.log(
      `[ROLLBACK] Starting rollback of ${createdHeaders.length} headers in reverse order`,
    );

    const result: RollbackResult = {
      successfullyDeletedHeaders: [],
      failedToDeleteHeaders: [],
      successfullyDeletedLines: [],
      failedToDeleteLines: [],
    };

    // Process headers in reverse order (last created to first created)
    const headersToProcess = [...createdHeaders].reverse();

    for (let i = 0; i < headersToProcess.length; i++) {
      const header = headersToProcess[i];
      const headerIndex = headersToProcess.length - i; // Original index (1-based)

      this.logger.log(
        `[ROLLBACK] Processing header ${headerIndex}/${createdHeaders.length}: ${header.headerKey}`,
      );

      try {
        // Step 1: Query lines from D365FO (don't assume we know all lines)
        this.logger.debug(
          `[ROLLBACK] Querying lines for header ${header.headerKey}`,
        );
        let existingLines: Array<{ LineNumber: number }> = [];
        try {
          existingLines = await strategy.listLinesForHeader(
            header.headerKey,
            header.dataAreaId,
          );
          this.logger.log(
            `[ROLLBACK] Found ${existingLines.length} lines for header ${header.headerKey}`,
          );
        } catch (error) {
          const errorDetails = dfoErrorMessage(error);
          this.logger.warn(
            `[ROLLBACK] Failed to query lines for header ${header.headerKey}: ${errorDetails}. Proceeding with deletion attempt.`,
          );
          // Continue - we'll try to delete header anyway, and if it fails with dependent lines error, we'll query again
        }

        // Step 2: Delete all lines for this header
        if (existingLines.length > 0) {
          const linesToDelete = existingLines.map((line) => ({
            headerId: header.headerKey,
            lineNumber: line.LineNumber,
          }));

          this.logger.log(
            `[ROLLBACK] Deleting ${linesToDelete.length} lines for header ${header.headerKey}`,
          );

          const lineDeleteResult = await strategy.deleteLinesInBatches(
            linesToDelete,
            header.dataAreaId,
            chunkSize,
          );

          result.successfullyDeletedLines.push(...lineDeleteResult.successful);
          result.failedToDeleteLines.push(...lineDeleteResult.failed);

          this.logger.log(
            `[ROLLBACK] Deleted ${lineDeleteResult.successful.length} lines for header ${header.headerKey}, ${lineDeleteResult.failed.length} failed`,
          );

          // Record failed line deletions
          for (const failed of lineDeleteResult.failed) {
            errorCollector.addRollbackError(
              `Failed to delete line: ${failed.error}`,
              `Line deletion for header ${header.headerKey}`,
              failed.headerId,
              failed.lineNumber,
            );
          }

          // Wait for D365FO to process line deletions and update header state
          // This reduces race conditions where header deletion is attempted before line deletions are fully processed
          if (lineDeleteResult.successful.length > 0) {
            this.logger.debug(
              `[ROLLBACK] Waiting for D365FO to process ${lineDeleteResult.successful.length} line deletions for header ${header.headerKey}`,
            );
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          // Verify all lines are deleted before attempting header deletion
          // This helps catch any lines that weren't properly deleted
          try {
            const remainingLinesAfterDeletion =
              await strategy.listLinesForHeader(
                header.headerKey,
                header.dataAreaId,
              );
            if (remainingLinesAfterDeletion.length > 0) {
              this.logger.warn(
                `[ROLLBACK] Found ${remainingLinesAfterDeletion.length} remaining lines after deletion attempt for header ${header.headerKey}, will retry deletion`,
              );
              // Store these for retry in header deletion logic
              existingLines = remainingLinesAfterDeletion;
            } else {
              this.logger.debug(
                `[ROLLBACK] Verified all lines deleted for header ${header.headerKey}`,
              );
              existingLines = [];
            }
          } catch (queryError) {
            this.logger.warn(
              `[ROLLBACK] Could not verify line deletion for header ${header.headerKey}: ${queryError}`,
            );
            // Continue anyway - header deletion will retry if needed
          }
        }

        // Step 3: Delete the header (with retry logic for dependent lines)
        // Only attempt if we verified no lines exist, or if we have retries available
        let headerDeleted = false;
        let retryCount = 0;
        const maxRetries = 3; // One initial attempt + up to 3 retries (increased for better reliability)

        while (!headerDeleted && retryCount <= maxRetries) {
          try {
            await strategy.deleteHeader(header.headerKey, header.dataAreaId);
            result.successfullyDeletedHeaders.push(header.headerKey);
            headerDeleted = true;
            this.logger.log(
              `[ROLLBACK] Successfully deleted header ${header.headerKey}`,
            );
          } catch (error: any) {
            const errorMessage = dfoErrorMessage(error);
            const isDependentLinesError = isDfoDependentLinesError(error);

            if (isDependentLinesError && retryCount < maxRetries) {
              retryCount++;
              this.logger.warn(
                `[ROLLBACK] Header deletion failed due to dependent lines (attempt ${retryCount}/${maxRetries}). Querying and deleting remaining lines for header ${header.headerKey}`,
              );

              // Query lines again (some might have been created after our initial query)
              try {
                const remainingLines = await strategy.listLinesForHeader(
                  header.headerKey,
                  header.dataAreaId,
                );

                if (remainingLines.length > 0) {
                  this.logger.log(
                    `[ROLLBACK] Found ${remainingLines.length} remaining lines for header ${header.headerKey}, deleting them`,
                  );

                  const remainingLinesToDelete = remainingLines.map((line) => ({
                    headerId: header.headerKey,
                    lineNumber: line.LineNumber,
                  }));

                  const remainingDeleteResult =
                    await strategy.deleteLinesInBatches(
                      remainingLinesToDelete,
                      header.dataAreaId,
                      chunkSize,
                    );

                  result.successfullyDeletedLines.push(
                    ...remainingDeleteResult.successful,
                  );
                  result.failedToDeleteLines.push(
                    ...remainingDeleteResult.failed,
                  );

                  // Record failed deletions
                  for (const failed of remainingDeleteResult.failed) {
                    errorCollector.addRollbackError(
                      `Failed to delete remaining line: ${failed.error}`,
                      `Remaining line deletion for header ${header.headerKey}`,
                      failed.headerId,
                      failed.lineNumber,
                    );
                  }

                  // Wait longer before retrying header deletion to ensure D365FO has processed all deletions
                  // Increased delay to allow D365FO internal processes to complete
                  await new Promise((resolve) => setTimeout(resolve, 1500));
                } else {
                  this.logger.debug(
                    `[ROLLBACK] No remaining lines found for header ${header.headerKey}`,
                  );
                }
              } catch (queryError) {
                this.logger.error(
                  `[ROLLBACK] Failed to query remaining lines for header ${header.headerKey}: ${queryError}`,
                );
              }
            } else {
              // Not a dependent lines error, or max retries reached
              result.failedToDeleteHeaders.push(header.headerKey);
              errorCollector.addRollbackError(
                `Failed to delete header: ${errorMessage}`,
                `Header deletion for ${header.headerKey}`,
                header.headerKey,
              );
              this.logger.error(
                `[ROLLBACK] Failed to delete header ${header.headerKey} after ${retryCount} attempts: ${errorMessage}`,
              );
              break;
            }
          }
        }
      } catch (error) {
        const errorDetails = dfoErrorMessage(error);
        this.logger.error(
          `[ROLLBACK] Unexpected error while rolling back header ${header.headerKey}: ${errorDetails}`,
          error instanceof Error ? error.stack : undefined,
        );
        result.failedToDeleteHeaders.push(header.headerKey);
        errorCollector.addRollbackError(
          `Unexpected error during rollback: ${errorDetails}`,
          `Header rollback for ${header.headerKey}`,
          header.headerKey,
        );
      }
    }

    this.logger.log(
      `[ROLLBACK] Rollback completed: ${result.successfullyDeletedHeaders.length} headers deleted, ${result.failedToDeleteHeaders.length} failed, ${result.successfullyDeletedLines.length} lines deleted, ${result.failedToDeleteLines.length} line deletions failed`,
    );

    return result;
  }
}
