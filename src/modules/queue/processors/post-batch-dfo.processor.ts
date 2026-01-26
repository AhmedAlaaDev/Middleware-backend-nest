import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { VendorInvoiceJournalService } from '@/modules/d365fo/services/vendor-invoice-journal.service';
import {
  D365FOFreeTextInvoiceHeaderRequest,
  D365FOFreeTextInvoiceLineRequest,
  D365FOVendorInvoiceJournalHeaderRequest,
  D365FOVendorInvoiceJournalLineRequest,
} from '@/modules/d365fo/types';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import {
  CreatedHeader,
  DfoRollbackService,
} from '@/modules/queue/services/dfo-rollback.service';
import { PostingErrorCollector } from '@/modules/queue/services/posting-error-collector.service';
import { IDfoPostingStrategy } from '@/modules/queue/strategies/dfo-posting-strategy.interface';
import { FreeTextInvoicePostingStrategy } from '@/modules/queue/strategies/free-text-invoice-posting.strategy';
import { VendorJournalPostingStrategy } from '@/modules/queue/strategies/vendor-journal-posting.strategy';

export interface PostBatchDFOJobData {
  batchId: string;
  company: string;
  entryProcessorName?: string;
  groupedInvoices?: Array<{
    header: D365FOFreeTextInvoiceHeaderRequest;
    lines: D365FOFreeTextInvoiceLineRequest[];
  }>;
  groupedJournals?: Array<{
    header: D365FOVendorInvoiceJournalHeaderRequest;
    lines: D365FOVendorInvoiceJournalLineRequest[];
  }>;
}

/**
 * Configuration constants for posting operations
 */
const POSTING_CONFIG = {
  HEADER_CHUNK_SIZE: 10,
  LINE_CHUNK_SIZE: 20,
  ROLLBACK_CHUNK_SIZE: 20,
} as const;

@Processor(QUEUES.DFO, {
  concurrency: 1, // Process 1 job at a time to prevent concurrent access to same journals
  // Reduced from 3 to avoid update conflicts when multiple jobs post to related journals
})
export class PostBatchDFOProcessor extends WorkerHost {
  private readonly logger = new Logger(PostBatchDFOProcessor.name);

  constructor(
    private readonly freeTextInvoicePostingStrategy: FreeTextInvoicePostingStrategy,
    private readonly vendorJournalPostingStrategy: VendorJournalPostingStrategy,
    private readonly vendorInvoiceJournalService: VendorInvoiceJournalService,
    private readonly dataBatchService: DataBatchService,
  ) {
    super();
  }

  /**
   * Main entry point for processing DFO posting jobs
   */
  public async process(job: Job<PostBatchDFOJobData>): Promise<void> {
    this.logger.log(
      `[JOB] Processing DFO job ${job.id} for batch ${job.data.batchId}`,
    );

    const errorCollector = new PostingErrorCollector();

    try {
      const strategy = this.selectPostingStrategy(job);
      await this.executePosting(job.data, strategy, errorCollector);

      this.logger.log(`Job ${job.id} completed successfully`);
    } catch (error) {
      const errorDetails = this.extractErrorDetails(error);
      errorCollector.addHeaderError(errorDetails, 'Job processing');

      this.logger.error(
        `Job ${job.id} failed: ${errorDetails}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.handlePostingFailure(job.data.batchId, errorCollector);

      throw error;
    }
  }

  /**
   * Selects the appropriate posting strategy based on job data
   */
  private selectPostingStrategy(
    job: Job<PostBatchDFOJobData>,
  ): IDfoPostingStrategy {
    // Determine strategy based on job name or data structure
    const jobName = job.name || '';
    const hasGroupedJournals = !!job.data.groupedJournals;
    const hasGroupedInvoices = !!job.data.groupedInvoices;

    // Switch on job name for explicit job types
    switch (jobName) {
      case 'post-vendor-batch-to-dfo':
        return this.vendorJournalPostingStrategy;
      case 'post-free-text-invoice-batch-to-dfo':
        return this.freeTextInvoicePostingStrategy;
      default:
        // Fallback to data structure if job name is not recognized
        if (hasGroupedJournals) {
          return this.vendorJournalPostingStrategy;
        }
        if (hasGroupedInvoices) {
          return this.freeTextInvoicePostingStrategy;
        }
        // Default to free text invoice strategy if unable to determine
        this.logger.warn(
          `[STRATEGY] Unable to determine posting strategy for job ${job.id}, defaulting to free text invoice strategy`,
        );
        return this.freeTextInvoicePostingStrategy;
    }
  }

  /**
   * Executes the complete posting process using sequential per-header strategy
   * Process: Header #1 -> All lines for Header #1 -> Header #2 -> All lines for Header #2 -> ...
   * If ANY error occurs, rollback ALL created headers
   */
  private async executePosting(
    data: PostBatchDFOJobData,
    strategy: IDfoPostingStrategy,
    errorCollector: PostingErrorCollector,
  ): Promise<void> {
    const { batchId, company } = data;
    const groupedData = this.extractGroupedData(data);

    if (!groupedData || groupedData.length === 0) {
      throw new Error('No grouped data provided for posting');
    }

    this.logger.log(
      `[POST] Starting sequential per-header posting: ${groupedData.length} headers to D365FO for batch ${batchId}`,
    );

    const createdHeaders: CreatedHeader[] = [];

    try {
      // Process each header sequentially: create header, then all its lines
      for (let i = 0; i < groupedData.length; i++) {
        const journal = groupedData[i] as {
          header: D365FOVendorInvoiceJournalHeaderRequest;
          lines: D365FOVendorInvoiceJournalLineRequest[];
        };

        const headerIndex = i + 1;
        this.logger.log(
          `[POST] Processing header ${headerIndex}/${groupedData.length}: ${journal.header.JournalBatchNumber}`,
        );

        // Step 1: Create header
        this.logger.log(
          `[POST] Creating header ${headerIndex}: ${journal.header.JournalBatchNumber}`,
        );
        try {
          // Use the strategy's postHeadersInBatches with a single header
          const headerResult = await strategy.postHeadersInBatches(
            [journal.header],
            1, // chunkSize = 1 for single header
          );

          if (headerResult.headerIds.length !== 1) {
            throw new Error(
              `Expected 1 header ID, got ${headerResult.headerIds.length}`,
            );
          }

          const headerKey = headerResult.headerIds[0];

          // Track created header
          createdHeaders.push({
            headerKey,
            dataAreaId: company,
          });

          this.logger.log(
            `[POST] Header ${headerIndex} created successfully: ${headerKey}`,
          );
        } catch (error) {
          const errorDetails = this.extractErrorDetails(error);
          this.logger.error(
            `[POST] Failed to create header ${headerIndex} (${journal.header.JournalBatchNumber}): ${errorDetails}`,
            error instanceof Error ? error.stack : undefined,
          );
          errorCollector.addHeaderError(
            errorDetails,
            `Header ${headerIndex} creation`,
          );
          throw new Error(
            `Failed to create header ${headerIndex}: ${errorDetails}`,
          );
        }

        // Step 2: Create ALL lines for this header (chunked, sequential, no parallel)
        const headerKey = createdHeaders[createdHeaders.length - 1].headerKey;
        this.logger.log(
          `[POST] Posting ${journal.lines.length} lines for header ${headerIndex} (${headerKey})`,
        );

        try {
          // Prepare lines with the created header key
          const preparedLines = journal.lines.map((line) => {
            const { FullPrimaryRemittanceAddress, ...cleanedLine } =
              line as any;
            return {
              ...cleanedLine,
              JournalBatchNumber: headerKey,
            } as D365FOVendorInvoiceJournalLineRequest;
          });

          // Use sequential posting method for vendor journals (chunked, sequential, no parallel)
          let postedLines: Array<{ headerId: string; lineNumber: number }>;
          if (strategy instanceof VendorJournalPostingStrategy) {
            // Use the sequential postLinesForHeader method with idempotency checks
            postedLines =
              await this.vendorInvoiceJournalService.postLinesForHeader(
                headerKey,
                preparedLines,
                POSTING_CONFIG.LINE_CHUNK_SIZE,
                company, // Pass dataAreaId for idempotency checks
              );
          } else {
            // Fallback to batch method for other strategies
            postedLines = await strategy.postLinesInBatches(
              preparedLines,
              POSTING_CONFIG.LINE_CHUNK_SIZE,
            );
          }

          this.logger.log(
            `[POST] Successfully posted ${postedLines.length} lines for header ${headerIndex} (${headerKey})`,
          );
        } catch (error) {
          const errorDetails = this.extractErrorDetails(error);
          this.logger.error(
            `[POST] Failed to post lines for header ${headerIndex} (${headerKey}): ${errorDetails}`,
            error instanceof Error ? error.stack : undefined,
          );
          errorCollector.addLineError(
            errorDetails,
            `Lines for header ${headerIndex}`,
          );
          throw new Error(
            `Failed to post lines for header ${headerIndex}: ${errorDetails}`,
          );
        }
      }

      // All headers and lines created successfully
      this.logger.log(
        `[POST] Successfully posted all ${createdHeaders.length} headers and their lines for batch ${batchId}`,
      );

      // Step 3: Handle successful completion
      const headerKeys = createdHeaders.map((h) => h.headerKey);
      await this.handlePostingSuccess(batchId, headerKeys);
    } catch (error) {
      const errorDetails = this.extractErrorDetails(error);
      this.logger.error(
        `[POST] Error during posting for batch ${batchId}: ${errorDetails}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Perform rollback of ALL created headers (even if some were completed successfully)
      if (createdHeaders.length > 0) {
        this.logger.log(
          `[ROLLBACK] Starting rollback of ${createdHeaders.length} created headers due to error`,
        );

        const rollbackService = new DfoRollbackService();
        const rollbackResult = await rollbackService.rollbackAll(
          strategy,
          createdHeaders,
          POSTING_CONFIG.ROLLBACK_CHUNK_SIZE,
          errorCollector,
        );

        // Log rollback results
        this.logger.log(
          `[ROLLBACK] Rollback completed: ${rollbackResult.successfullyDeletedHeaders.length} headers deleted, ${rollbackResult.failedToDeleteHeaders.length} failed, ${rollbackResult.successfullyDeletedLines.length} lines deleted, ${rollbackResult.failedToDeleteLines.length} line deletions failed`,
        );

        // Store IDs of headers that couldn't be deleted
        if (rollbackResult.failedToDeleteHeaders.length > 0) {
          this.logger.warn(
            `[ROLLBACK] ${rollbackResult.failedToDeleteHeaders.length} headers could not be deleted and remain in D365FO`,
          );
          await this.storeCreatedHeaderIds(
            batchId,
            rollbackResult.failedToDeleteHeaders,
          );
        }
      }

      throw error;
    }
  }

  /**
   * Posts headers in batches and tracks errors
   */
  private async postHeadersWithTracking(
    strategy: IDfoPostingStrategy,
    groupedData: unknown[],
    errorCollector: PostingErrorCollector,
  ): Promise<{ headerIds: string[] }> {
    this.logger.debug('[POST] Step 1: Posting headers...');

    try {
      const allHeaders = this.extractHeadersFromGroupedData(groupedData);
      const result = await strategy.postHeadersInBatches(
        allHeaders,
        POSTING_CONFIG.HEADER_CHUNK_SIZE,
      );

      if (result.headerIds.length !== groupedData.length) {
        throw new Error(
          `Header count mismatch: expected ${groupedData.length}, got ${result.headerIds.length}`,
        );
      }

      this.logger.debug(
        `Successfully posted ${result.headerIds.length} headers`,
      );

      return { headerIds: result.headerIds };
    } catch (error) {
      const errorDetails = this.extractErrorDetails(error);
      errorCollector.addHeaderError(errorDetails, 'Header posting');
      throw error;
    }
  }

  /**
   * Posts lines in batches and tracks successfully posted lines
   */
  private async postLinesWithTracking(
    strategy: IDfoPostingStrategy,
    preparedLines: unknown[],
    headerIds: string[],
    errorCollector: PostingErrorCollector,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    this.logger.debug(
      `[POST] Step 2: Posting ${preparedLines.length} lines...`,
    );

    try {
      const postedLines = await strategy.postLinesInBatches(
        preparedLines,
        POSTING_CONFIG.LINE_CHUNK_SIZE,
      );

      this.logger.debug(
        `[POST] Step 2: Successfully posted ${postedLines.length} of ${preparedLines.length} lines`,
      );

      return postedLines;
    } catch (error) {
      const errorDetails = this.extractErrorDetails(error);

      // Log full error details for debugging
      if (error instanceof Error && error.message) {
        this.logger.error(
          `Line posting error details: ${error.message}`,
          error.stack,
        );
      }

      // Try to identify which header/line failed
      errorCollector.addLineError(errorDetails, 'Line posting batch');

      throw error;
    }
  }

  /**
   * Performs rollback by deleting headers first, then lines if needed
   * Headers are deleted first as they may cascade delete lines in D365FO
   */
  private async performRollback(
    strategy: IDfoPostingStrategy,
    createdHeaderIdentifiers: string[],
    successfullyPostedLines: Array<{ headerId: string; lineNumber: number }>,
    areHeadersPosted: boolean,
    company: string,
    errorCollector: PostingErrorCollector,
  ): Promise<{
    failedToDeleteHeaders: string[];
    failedToDeleteLines: Array<{
      headerId: string;
      lineNumber: number;
      error: string;
    }>;
  }> {
    if (!areHeadersPosted) {
      // Nothing was created, no rollback needed
      return {
        failedToDeleteHeaders: [],
        failedToDeleteLines: [],
      };
    }

    this.logger.log(
      `[ROLLBACK] Starting rollback: ${createdHeaderIdentifiers.length} headers, ${successfullyPostedLines.length} lines`,
    );

    const rollbackService = new DfoRollbackService();

    // Step 1: Delete headers first (they may cascade delete lines)
    const headerRollbackResult = await rollbackService.rollbackHeaders(
      strategy,
      createdHeaderIdentifiers,
      company,
      POSTING_CONFIG.ROLLBACK_CHUNK_SIZE,
      errorCollector,
    );

    // Step 2: If headers were deleted successfully, lines might be cascade-deleted
    // Only try to delete lines if we have successfully posted lines AND some headers failed to delete
    // (meaning those headers' lines might still exist)
    let linesToDelete: Array<{ headerId: string; lineNumber: number }> | null =
      null;

    if (
      successfullyPostedLines.length > 0 &&
      headerRollbackResult.failedToDelete.length > 0
    ) {
      // Only try to delete lines for headers that couldn't be deleted
      const failedHeaderIds = new Set(headerRollbackResult.failedToDelete);
      linesToDelete = successfullyPostedLines.filter((line) =>
        failedHeaderIds.has(line.headerId),
      );

      if (linesToDelete.length > 0) {
        this.logger.debug(
          `[ROLLBACK] Attempting to delete ${linesToDelete.length} lines for headers that couldn't be deleted`,
        );

        const lineRollbackResult = await rollbackService.rollbackLines(
          strategy,
          linesToDelete,
          company,
          POSTING_CONFIG.ROLLBACK_CHUNK_SIZE,
          errorCollector,
        );

        return {
          failedToDeleteHeaders: headerRollbackResult.failedToDelete,
          failedToDeleteLines: lineRollbackResult.failedToDelete,
        };
      }
    }

    // If all headers were deleted successfully, assume lines were cascade-deleted
    if (
      headerRollbackResult.successfullyDeleted.length ===
      createdHeaderIdentifiers.length
    ) {
      this.logger.debug(
        'All headers deleted successfully, assuming lines were cascade-deleted',
      );
    }

    return {
      failedToDeleteHeaders: headerRollbackResult.failedToDelete,
      failedToDeleteLines: [],
    };
  }

  /**
   * Handles successful posting completion
   */
  private async handlePostingSuccess(
    batchId: string,
    createdHeaderIdentifiers: string[],
  ): Promise<void> {
    // Store IDs only on full success
    await this.storeCreatedHeaderIds(batchId, createdHeaderIdentifiers);
    await this.dataBatchService.clearDfoPostingErrorsAsync(batchId);
    await this.dataBatchService.updateStatusAsync(
      batchId,
      DataBatchStatus.Completed,
    );

    this.logger.log(
      `[SUCCESS] Successfully posted batch ${batchId} with ${createdHeaderIdentifiers.length} items`,
    );
  }

  /**
   * Handles posting failure by updating batch status and errors
   */
  private async handlePostingFailure(
    batchId: string,
    errorCollector: PostingErrorCollector,
  ): Promise<void> {
    const formattedErrors = errorCollector.getFormattedErrorMessages();

    await this.dataBatchService.updateDfoPostingErrorsAsync(
      batchId,
      formattedErrors,
    );
    await this.dataBatchService.updateStatusAsync(
      batchId,
      DataBatchStatus.Canceled,
    );
  }

  /**
   * Stores created header IDs in the batch
   */
  private async storeCreatedHeaderIds(
    batchId: string,
    headerIds: string[],
  ): Promise<void> {
    if (headerIds.length === 0) {
      return;
    }

    // Get existing IDs and merge with new ones
    const batch = await this.dataBatchService.getByIdAsync(batchId);
    const existingIds = batch?.dfoIds || [];
    const allIds = [...new Set([...existingIds, ...headerIds])];

    await this.dataBatchService.updateDfoIdsAsync(batchId, allIds);
    this.logger.debug(
      `[STORE] Stored ${headerIds.length} header IDs for batch ${batchId}`,
    );
  }

  /**
   * Extracts grouped data from job data
   */
  private extractGroupedData(data: PostBatchDFOJobData): unknown[] | null {
    if (data.groupedJournals) {
      return data.groupedJournals;
    }
    if (data.groupedInvoices) {
      return data.groupedInvoices;
    }
    return null;
  }

  /**
   * Extracts headers from grouped data
   */
  private extractHeadersFromGroupedData(groupedData: unknown[]): unknown[] {
    return groupedData.map((item: any) => item.header);
  }

  /**
   * Extracts error details from D365FO API error response
   * Handles OData error format: { error: { code: "...", message: "...", innererror: { message: "..." } } }
   * Prioritizes innererror.message as it contains the detailed error message
   */
  private extractErrorDetails(error: any): string {
    // Check for D365FO OData error format
    if (error?.response?.data?.error) {
      const d365foError = error.response.data.error;

      // OData error format: { code: "...", message: "...", innererror: { message: "..." } }
      if (typeof d365foError === 'object') {
        // Prioritize innererror.message as it contains the detailed error message
        const innerErrorMessage = d365foError.innererror?.message;
        const genericMessage = d365foError.message;
        const code = d365foError.code;

        // Use innererror message if available (more detailed), otherwise fallback to generic message
        const message = innerErrorMessage || genericMessage || d365foError.code;

        if (message) {
          return code ? `[${code}] ${message}` : message;
        }

        // If message is not directly available, try to stringify the error object
        try {
          return JSON.stringify(d365foError);
        } catch {
          return String(d365foError);
        }
      }

      // If error is a string
      if (typeof d365foError === 'string') {
        return d365foError;
      }
    }

    // Fallback to standard error message extraction
    if (error?.response?.data?.error_description) {
      return error.response.data.error_description;
    }

    if (error?.response?.data?.message) {
      return error.response.data.message;
    }

    if (error?.message) {
      return error.message;
    }

    if (error?.response?.statusText) {
      return `HTTP ${error.response.status}: ${error.response.statusText}`;
    }

    return String(error);
  }
}
