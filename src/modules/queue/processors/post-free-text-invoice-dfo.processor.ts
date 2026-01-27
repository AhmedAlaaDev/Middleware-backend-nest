import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { DfoErrorExtractorService } from '@/modules/d365fo/services/dfo-error-extractor.service';
import { FreeTextInvoiceFinTagService } from '@/modules/d365fo/services/free-text-invoice-fin-tag.service';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import { PostFreeTextInvoiceDFOJobPayload } from '@/modules/queue/contracts/post-free-text-invoice-dfo-job.contract';
import {
  CreatedHeader,
  DfoRollbackService,
} from '@/modules/queue/services/dfo-rollback.service';
import { PostingErrorCollector } from '@/modules/queue/services/posting-error-collector.service';
import { FreeTextInvoicePostingStrategy } from '@/modules/queue/strategies/free-text-invoice-posting.strategy';

const LINE_CHUNK_SIZE = 20;
const ROLLBACK_CHUNK_SIZE = 20;

@Processor(QUEUES.DFO_FREE_TEXT_INVOICE, { concurrency: 1 })
export class PostFreeTextInvoiceDFOProcessor extends WorkerHost {
  private readonly logger = new Logger(PostFreeTextInvoiceDFOProcessor.name);

  constructor(
    private readonly strategy: FreeTextInvoicePostingStrategy,
    private readonly dataBatchService: DataBatchService,
    private readonly freeTextInvoiceFinTagService: FreeTextInvoiceFinTagService,
    private readonly dfoRollbackService: DfoRollbackService,
    private readonly dfoErrorExtractor: DfoErrorExtractorService,
  ) {
    super();
  }

  async process(job: Job<PostFreeTextInvoiceDFOJobPayload>): Promise<void> {
    this.logger.log(
      `[JOB] Processing FTI job ${job.id} for batch ${job.data.batchId}`,
    );
    const payload = job.data;
    if (!payload.groupedInvoices?.length) {
      throw new Error('No groupedInvoices or empty');
    }
    const errorCollector = new PostingErrorCollector();
    try {
      await this.executePosting(payload, errorCollector);
      this.logger.log(`Job ${job.id} completed successfully`);
    } catch (error) {
      const msg = this.dfoErrorExtractor.extractMessage(error);
      errorCollector.addHeaderError(msg, 'Job processing');
      this.logger.error(
        `Job ${job.id} failed: ${msg}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.handlePostingFailure(payload.batchId, errorCollector);
      throw error;
    }
  }

  private async executePosting(
    data: PostFreeTextInvoiceDFOJobPayload,
    errorCollector: PostingErrorCollector,
  ): Promise<void> {
    const { batchId, company, groupedInvoices } = data;
    const createdHeaders: CreatedHeader[] = [];
    this.logger.log(
      `[POST] Starting sequential posting: ${groupedInvoices.length} headers for batch ${batchId}`,
    );
    try {
      for (let i = 0; i < groupedInvoices.length; i++) {
        await this.postOneGroup(
          groupedInvoices[i],
          i + 1,
          groupedInvoices.length,
          company,
          createdHeaders,
          errorCollector,
        );
      }
      const headerKeys = createdHeaders.map((h) => h.headerKey);
      await this.handlePostingSuccess(batchId, headerKeys);
    } catch (error) {
      const msg = this.dfoErrorExtractor.extractMessage(error);
      this.logger.error(
        `[POST] Error for batch ${batchId}: ${msg}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (createdHeaders.length > 0) {
        this.logger.log(
          `[ROLLBACK] Rolling back ${createdHeaders.length} headers`,
        );
        const rollbackResult = await this.dfoRollbackService.rollbackAll(
          this.strategy,
          createdHeaders,
          ROLLBACK_CHUNK_SIZE,
          errorCollector,
        );
        this.logger.log(
          `[ROLLBACK] Done: ${rollbackResult.successfullyDeletedHeaders.length} headers deleted, ${rollbackResult.failedToDeleteHeaders.length} failed`,
        );
        if (rollbackResult.failedToDeleteHeaders.length > 0) {
          await this.storeCreatedHeaderIds(
            batchId,
            rollbackResult.failedToDeleteHeaders,
          );
        }
      }
      throw error;
    }
  }

  private async postOneGroup(
    invoice: PostFreeTextInvoiceDFOJobPayload['groupedInvoices'][0],
    index: number,
    total: number,
    company: string,
    createdHeaders: CreatedHeader[],
    errorCollector: PostingErrorCollector,
  ): Promise<void> {
    const headerResult = await this.strategy.postHeadersInBatches(
      [invoice.header],
      1,
    );
    if (headerResult.headerIds.length !== 1) {
      throw new Error(
        `Expected 1 header ID, got ${headerResult.headerIds.length}`,
      );
    }
    const headerKey = headerResult.headerIds[0];
    createdHeaders.push({ headerKey, dataAreaId: company });
    this.logger.log(`[POST] Header ${index}/${total} created: ${headerKey}`);
    const postedLines = await this.strategy.postLinesForHeader(
      headerKey,
      invoice.lines,
      company,
      LINE_CHUNK_SIZE,
    );
    this.logger.log(
      `[POST] Posted ${postedLines.length} lines for header ${index}`,
    );
    if (
      invoice.HeaderDefaultDimensionDisplayValue &&
      invoice.LineFinTagDisplayValues?.length
    ) {
      const lineDataString = postedLines
        .map(
          (p, j) =>
            `${p.lineNumber},${invoice.LineFinTagDisplayValues[j] ?? ''}`,
        )
        .join(';');
      try {
        await this.freeTextInvoiceFinTagService.updateFinTag(
          company,
          parseInt(headerKey, 10),
          invoice.HeaderDefaultDimensionDisplayValue,
          lineDataString,
        );
      } catch (err) {
        const msg = this.dfoErrorExtractor.extractMessage(err);
        this.logger.warn(
          `[FIN TAG] Fin tag update failed for ${headerKey}: ${msg}`,
        );
        errorCollector.addHeaderError(
          `Fin tag: ${msg}`,
          `Header ${index} fin tag`,
        );
      }
    }
  }

  private async handlePostingFailure(
    batchId: string,
    errorCollector: PostingErrorCollector,
  ): Promise<void> {
    const formatted = errorCollector.getFormattedErrorMessages();
    await this.dataBatchService.updateDfoPostingErrorsAsync(batchId, formatted);
    await this.dataBatchService.updateStatusAsync(
      batchId,
      DataBatchStatus.Canceled,
    );
  }

  private async handlePostingSuccess(
    batchId: string,
    headerKeys: string[],
  ): Promise<void> {
    await this.storeCreatedHeaderIds(batchId, headerKeys);
    await this.dataBatchService.clearDfoPostingErrorsAsync(batchId);
    await this.dataBatchService.updateStatusAsync(
      batchId,
      DataBatchStatus.Completed,
    );
    this.logger.log(
      `[SUCCESS] Batch ${batchId} posted ${headerKeys.length} items`,
    );
  }

  private async storeCreatedHeaderIds(
    batchId: string,
    headerIds: string[],
  ): Promise<void> {
    if (headerIds.length === 0) return;
    const batch = await this.dataBatchService.getByIdAsync(batchId);
    const existing = batch?.dfoIds ?? [];
    const all = [...new Set([...existing, ...headerIds])];
    await this.dataBatchService.updateDfoIdsAsync(batchId, all);
  }
}
