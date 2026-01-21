import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { FreeTextInvoiceService } from '@/modules/d365fo/services/free-text-invoice.service';
import {
  D365FOFreeTextInvoiceHeaderRequest,
  D365FOFreeTextInvoiceLineRequest,
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
}

@Processor(QUEUES.DFO, {
  concurrency: 3, // Process 3 jobs concurrently
})
export class PostBatchDFOProcessor extends WorkerHost {
  private readonly logger = new Logger(PostBatchDFOProcessor.name);

  constructor(
    private readonly freeTextInvoiceService: FreeTextInvoiceService,
    private readonly dataBatchService: DataBatchService,
  ) {
    super();
  }

  public async process(job: Job<PostBatchDFOJobData>): Promise<void> {
    this.logger.log(
      `Processing DFO job ${job.id} for batch ${job.data.batchId}`,
    );

    try {
      await this.postToD365FO(job.data);

      this.logger.log(`Job ${job.id} completed successfully`);
    } catch (error) {
      this.logger.error(`Job ${job.id} failed: ${error.message}`, error.stack);

      // Update batch with errors
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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
      this.logger.debug(`Successfully posted ${headerIds.length} headers`);

      // Step 2: Post all lines with corresponding ParentRecId
      this.logger.debug('Posting lines...');
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

      // Step 3: Update batch with created IDs
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push(errorMessage);

      this.logger.error(
        `Error posting batch ${batchId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Rollback: Delete all successfully created headers
      if (createdHeaderIds.length > 0) {
        this.logger.log(
          `Rolling back: deleting ${createdHeaderIds.length} created headers`,
        );

        for (const headerId of createdHeaderIds) {
          try {
            await this.freeTextInvoiceService.deleteHeader(headerId, company);
          } catch (deleteError) {
            this.logger.error(
              `Failed to delete header ${headerId} during rollback: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`,
            );
            errors.push(
              `Rollback failed for header ${headerId}: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`,
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
