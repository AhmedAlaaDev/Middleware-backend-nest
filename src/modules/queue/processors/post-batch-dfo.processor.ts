import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  D365FOFreeTextInvoiceHeaderRequest,
  D365FOFreeTextInvoiceLineRequest,
  D365FOVendorInvoiceJournalHeaderRequest,
  D365FOVendorInvoiceJournalLineRequest,
} from '@/modules/d365fo/types';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import { DfoRollbackService } from '@/modules/queue/services/dfo-rollback.service';
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
  concurrency: 3, // Process 3 jobs concurrently
})
export class PostBatchDFOProcessor extends WorkerHost {
  private readonly logger = new Logger(PostBatchDFOProcessor.name);

  constructor(
    private readonly freeTextInvoicePostingStrategy: FreeTextInvoicePostingStrategy,
    private readonly vendorJournalPostingStrategy: VendorJournalPostingStrategy,
    private readonly dataBatchService: DataBatchService,
  ) {
    super();
  }

  /**
   * Main entry point for processing DFO posting jobs
   */
  public async process(job: Job<PostBatchDFOJobData>): Promise<void> {
    this.logger.log(
      `Processing DFO job ${job.id} for batch ${job.data.batchId}`,
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
          `Unable to determine posting strategy for job ${job.id}, defaulting to free text invoice strategy`,
        );
        return this.freeTextInvoicePostingStrategy;
    }
  }

  /**
   * Executes the complete posting process using the provided strategy
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
      `Posting ${groupedData.length} items to D365FO for batch ${batchId}`,
    );

    const createdHeaderIdentifiers: string[] = [];
    let areHeadersPosted = false;
    const successfullyPostedLines: Array<{
      headerId: string;
      lineNumber: number;
    }> = [];

    try {
      // Step 1: Post headers in batches
      const headerPostingResult = await this.postHeadersWithTracking(
        strategy,
        groupedData,
        errorCollector,
      );

      createdHeaderIdentifiers.push(...headerPostingResult.headerIds);
      areHeadersPosted = true;

      // Step 2: Prepare and post lines
      const preparedLines = strategy.prepareLinesForPosting(
        [],
        createdHeaderIdentifiers,
        groupedData,
      );

      const postedLines = await this.postLinesWithTracking(
        strategy,
        preparedLines,
        createdHeaderIdentifiers,
        errorCollector,
      );

      successfullyPostedLines.push(...postedLines);

      // Step 3: Handle successful completion
      await this.handlePostingSuccess(batchId, createdHeaderIdentifiers);
    } catch (error) {
      const errorDetails = this.extractErrorDetails(error);
      errorCollector.addLineError(errorDetails, 'Line posting');

      this.logger.error(
        `Error during posting for batch ${batchId}: ${errorDetails}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Perform rollback if needed - only rollback what was actually created
      const rollbackResult = await this.performRollback(
        strategy,
        createdHeaderIdentifiers,
        successfullyPostedLines,
        areHeadersPosted,
        company,
        errorCollector,
      );

      // Store IDs of headers that couldn't be deleted
      if (rollbackResult.failedToDeleteHeaders.length > 0) {
        await this.storeCreatedHeaderIds(
          batchId,
          rollbackResult.failedToDeleteHeaders,
        );
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
    this.logger.debug('Posting headers...');

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
    this.logger.debug('Posting lines...');

    try {
      const postedLines = await strategy.postLinesInBatches(
        preparedLines,
        POSTING_CONFIG.LINE_CHUNK_SIZE,
      );

      this.logger.debug(
        `Successfully posted ${postedLines.length} of ${preparedLines.length} lines`,
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
      `Starting rollback: ${createdHeaderIdentifiers.length} headers, ${successfullyPostedLines.length} lines`,
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
          `Attempting to delete ${linesToDelete.length} lines for headers that couldn't be deleted`,
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
      `Successfully posted batch ${batchId} with ${createdHeaderIdentifiers.length} items`,
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
      `Stored ${headerIds.length} header IDs for batch ${batchId}`,
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
