import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { FreeTextInvoiceService } from '@/modules/d365fo/services/free-text-invoice.service';
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

@Processor(QUEUES.DFO, {
  concurrency: 3, // Process 3 jobs concurrently
})
export class PostBatchDFOProcessor extends WorkerHost {
  private readonly logger = new Logger(PostBatchDFOProcessor.name);

  constructor(
    private readonly freeTextInvoiceService: FreeTextInvoiceService,
    private readonly vendorInvoiceJournalService: VendorInvoiceJournalService,
    private readonly dataBatchService: DataBatchService,
  ) {
    super();
  }

  public async process(job: Job<PostBatchDFOJobData>): Promise<void> {
    this.logger.log(
      `Processing DFO job ${job.id} for batch ${job.data.batchId}`,
    );

    try {
      // Determine job type based on job name or data structure
      const isVendorJob =
        job.name === 'post-vendor-batch-to-dfo' || !!job.data.groupedJournals;

      if (isVendorJob) {
        await this.postVendorJournalsToD365FO(job.data);
      } else {
        await this.postToD365FO(job.data);
      }

      this.logger.log(`Job ${job.id} completed successfully`);
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.logger.error(`Job ${job.id} failed: ${errorMessage}`, error.stack);

      // Update batch with errors
      await this.dataBatchService.updateDfoPostingErrorsAsync(
        job.data.batchId,
        [errorMessage],
      );
      await this.dataBatchService.updateStatusAsync(
        job.data.batchId,
        DataBatchStatus.Canceled,
      );

      throw error;
    }
  }

  /**
   * Extracts error message from D365FO API error response
   * Handles OData error format: { error: { code: "...", message: "...", innererror: { message: "..." } } }
   * Prioritizes innererror.message as it contains the detailed error message
   */
  private extractErrorMessage(error: any): string {
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

  private async postToD365FO(data: PostBatchDFOJobData): Promise<void> {
    const { batchId, company, groupedInvoices } = data;

    if (!groupedInvoices || groupedInvoices.length === 0) {
      throw new Error('No grouped invoices provided for posting');
    }

    this.logger.log(
      `Posting ${groupedInvoices.length} invoices to D365FO for batch ${batchId}`,
    );

    const createdHeaderIds: string[] = [];
    const errors: string[] = [];
    let headersPosted = false;
    let linesPostingStarted = false;

    try {
      // Step 1: Post all headers in chunks
      this.logger.debug('Posting headers...');
      const allHeaders = groupedInvoices.map((inv) => inv.header);
      const headerIds = await this.freeTextInvoiceService.postHeadersBatch(
        allHeaders,
        10, // chunk size
      );

      if (headerIds.length !== groupedInvoices.length) {
        throw new Error(
          `Header count mismatch: expected ${groupedInvoices.length}, got ${headerIds.length}`,
        );
      }

      createdHeaderIds.push(...headerIds);
      headersPosted = true;
      this.logger.debug(`Successfully posted ${headerIds.length} headers`);

      // Step 2: Post all lines with corresponding ParentRecId
      this.logger.debug('Posting lines...');
      linesPostingStarted = true;
      const allLines: D365FOFreeTextInvoiceLineRequest[] = [];

      for (let i = 0; i < groupedInvoices.length; i++) {
        const invoice = groupedInvoices[i];
        const headerId = headerIds[i];

        // Update ParentRecId for all lines in this invoice
        const linesWithParentId = invoice.lines.map((line) => ({
          ...line,
          ParentRecId: parseInt(headerId, 10),
        }));

        allLines.push(...linesWithParentId);
      }

      await this.freeTextInvoiceService.postLinesBatch(allLines, 20); // chunk size
      this.logger.debug(`Successfully posted ${allLines.length} lines`);

      // Step 3: Update batch with created IDs (only if everything succeeded)
      await this.dataBatchService.updateDfoIdsAsync(batchId, createdHeaderIds);
      await this.dataBatchService.clearDfoPostingErrorsAsync(batchId);
      await this.dataBatchService.updateStatusAsync(
        batchId,
        DataBatchStatus.Completed,
      );

      this.logger.log(
        `Successfully posted batch ${batchId} with ${createdHeaderIds.length} invoices`,
      );
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      errors.push(errorMessage);

      this.logger.error(
        `Error posting batch ${batchId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Rollback: If headers were posted and lines posting started/failed,
      // delete ALL headers (this will cascade delete any created lines)
      if (headersPosted && linesPostingStarted) {
        this.logger.log(
          `Rolling back: deleting ${createdHeaderIds.length} created headers (and their associated lines) due to line posting failure`,
        );

        for (const headerId of createdHeaderIds) {
          try {
            await this.freeTextInvoiceService.deleteHeader(headerId, company);
            this.logger.debug(
              `Successfully deleted header ${headerId} during rollback`,
            );
          } catch (deleteError) {
            const deleteErrorMessage = this.extractErrorMessage(deleteError);
            this.logger.error(
              `Failed to delete header ${headerId} during rollback: ${deleteErrorMessage}`,
            );
            errors.push(
              `Rollback failed for header ${headerId}: ${deleteErrorMessage}`,
            );
          }
        }
      } else if (headersPosted) {
        // Headers posted but lines posting hasn't started yet
        this.logger.log(
          `Rolling back: deleting ${createdHeaderIds.length} created headers (no lines posted yet)`,
        );

        for (const headerId of createdHeaderIds) {
          try {
            await this.freeTextInvoiceService.deleteHeader(headerId, company);
          } catch (deleteError) {
            const deleteErrorMessage = this.extractErrorMessage(deleteError);
            this.logger.error(
              `Failed to delete header ${headerId} during rollback: ${deleteErrorMessage}`,
            );
            errors.push(
              `Rollback failed for header ${headerId}: ${deleteErrorMessage}`,
            );
          }
        }
      }

      // Update batch with errors
      await this.dataBatchService.updateDfoPostingErrorsAsync(batchId, errors);
      await this.dataBatchService.updateStatusAsync(
        batchId,
        DataBatchStatus.Canceled,
      );

      throw error;
    }
  }

  private async postVendorJournalsToD365FO(
    data: PostBatchDFOJobData,
  ): Promise<void> {
    const { batchId, company, groupedJournals } = data;

    if (!groupedJournals || groupedJournals.length === 0) {
      throw new Error('No grouped journals provided for posting');
    }

    this.logger.log(
      `Posting ${groupedJournals.length} journal batches to D365FO for batch ${batchId}`,
    );

    const createdJournalBatchNumbers: string[] = [];
    const errors: string[] = [];
    let headersPosted = false;
    let linesPostingStarted = false;

    try {
      // Step 1: Post all headers in chunks
      this.logger.debug('Posting journal headers...');
      const allHeaders = groupedJournals.map((journal) => journal.header);
      const journalBatchNumbers =
        await this.vendorInvoiceJournalService.postHeadersBatch(
          allHeaders,
          10, // chunk size
        );

      if (journalBatchNumbers.length !== groupedJournals.length) {
        throw new Error(
          `Header count mismatch: expected ${groupedJournals.length}, got ${journalBatchNumbers.length}`,
        );
      }

      createdJournalBatchNumbers.push(...journalBatchNumbers);
      headersPosted = true;
      this.logger.debug(
        `Successfully posted ${journalBatchNumbers.length} headers`,
      );

      // Step 2: Post all lines (lines already have JournalBatchNumber set, no need to update)
      this.logger.debug('Posting journal lines...');
      linesPostingStarted = true;
      const allLines: D365FOVendorInvoiceJournalLineRequest[] = [];

      for (const journal of groupedJournals) {
        // Remove FullPrimaryRemittanceAddress from each line before posting
        const cleanedLines = journal.lines.map((line) => {
          const { FullPrimaryRemittanceAddress, ...cleanedLine } = line as any;
          return cleanedLine as D365FOVendorInvoiceJournalLineRequest;
        });
        allLines.push(...cleanedLines);
      }

      // Post lines in chunks - if ANY line fails, we'll rollback everything
      await this.vendorInvoiceJournalService.postLinesBatch(allLines, 20); // chunk size
      this.logger.debug(`Successfully posted ${allLines.length} lines`);

      // Step 3: Update batch with created IDs (only if everything succeeded)
      await this.dataBatchService.updateDfoIdsAsync(
        batchId,
        createdJournalBatchNumbers,
      );
      await this.dataBatchService.clearDfoPostingErrorsAsync(batchId);
      await this.dataBatchService.updateStatusAsync(
        batchId,
        DataBatchStatus.Completed,
      );

      this.logger.log(
        `Successfully posted batch ${batchId} with ${createdJournalBatchNumbers.length} journal batches`,
      );
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      errors.push(errorMessage);

      this.logger.error(
        `Error posting batch ${batchId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Rollback: If headers were posted and lines posting started/failed,
      // delete ALL headers (this will cascade delete any created lines)
      if (headersPosted && linesPostingStarted) {
        this.logger.log(
          `Rolling back: deleting ${createdJournalBatchNumbers.length} created headers (and their associated lines) due to line posting failure`,
        );

        for (const journalBatchNumber of createdJournalBatchNumbers) {
          try {
            await this.vendorInvoiceJournalService.deleteHeader(
              journalBatchNumber,
              company,
            );
            this.logger.debug(
              `Successfully deleted header ${journalBatchNumber} during rollback`,
            );
          } catch (deleteError) {
            const deleteErrorMessage = this.extractErrorMessage(deleteError);
            this.logger.error(
              `Failed to delete header ${journalBatchNumber} during rollback: ${deleteErrorMessage}`,
            );
            errors.push(
              `Rollback failed for header ${journalBatchNumber}: ${deleteErrorMessage}`,
            );
          }
        }
      } else if (headersPosted) {
        // Headers posted but lines posting hasn't started yet
        this.logger.log(
          `Rolling back: deleting ${createdJournalBatchNumbers.length} created headers (no lines posted yet)`,
        );

        for (const journalBatchNumber of createdJournalBatchNumbers) {
          try {
            await this.vendorInvoiceJournalService.deleteHeader(
              journalBatchNumber,
              company,
            );
          } catch (deleteError) {
            const deleteErrorMessage = this.extractErrorMessage(deleteError);
            this.logger.error(
              `Failed to delete header ${journalBatchNumber} during rollback: ${deleteErrorMessage}`,
            );
            errors.push(
              `Rollback failed for header ${journalBatchNumber}: ${deleteErrorMessage}`,
            );
          }
        }
      }

      // Update batch with errors
      await this.dataBatchService.updateDfoPostingErrorsAsync(batchId, errors);
      await this.dataBatchService.updateStatusAsync(
        batchId,
        DataBatchStatus.Canceled,
      );

      throw error;
    }
  }
}
