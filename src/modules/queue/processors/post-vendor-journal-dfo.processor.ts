import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { DfoErrorExtractorService } from '@/modules/d365fo/services/dfo-error-extractor.service';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import { PostVendorJournalDFOJobPayload } from '@/modules/queue/contracts/post-vendor-journal-dfo-job.contract';
import {
  CreatedHeader,
  DfoRollbackService,
} from '@/modules/queue/services/dfo-rollback.service';
import { PostingErrorCollector } from '@/modules/queue/services/posting-error-collector.service';
import { IDfoPostingStrategy } from '@/modules/queue/strategies/dfo-posting-strategy.interface';
import { VendorJournalPostingStrategy } from '@/modules/queue/strategies/vendor-journal-posting.strategy';
import { VendorPaymentJournalPostingStrategy } from '@/modules/queue/strategies/vendor-payment-journal-posting.strategy';

const LINE_CHUNK_SIZE = 20;
const ROLLBACK_CHUNK_SIZE = 20;

@Processor(QUEUES.DFO_VENDOR_JOURNAL, { concurrency: 1 })
export class PostVendorJournalDFOProcessor extends WorkerHost {
  private readonly logger = new Logger(PostVendorJournalDFOProcessor.name);

  constructor(
    private readonly vendorJournalStrategy: VendorJournalPostingStrategy,
    private readonly vendorPaymentJournalStrategy: VendorPaymentJournalPostingStrategy,
    private readonly dataBatchService: DataBatchService,
    private readonly dfoRollbackService: DfoRollbackService,
    private readonly dfoErrorExtractor: DfoErrorExtractorService,
  ) {
    super();
  }

  async process(job: Job<PostVendorJournalDFOJobPayload>): Promise<void> {
    this.logger.log(
      `[JOB] Processing VJ job ${job.id} for batch ${job.data.batchId}`,
    );
    const payload = job.data;
    const isPayment =
      payload.journalKind === 'payment' &&
      payload.paymentGroupedJournals &&
      payload.paymentGroupedJournals.length > 0;
    const isInvoice =
      (payload.journalKind === 'invoice' || !payload.journalKind) &&
      payload.groupedJournals &&
      payload.groupedJournals.length > 0;

    if (!isPayment && !isInvoice) {
      throw new Error(
        'No groupedJournals or paymentGroupedJournals; set journalKind and provide the matching payload',
      );
    }

    const strategy: IDfoPostingStrategy = isPayment
      ? this.vendorPaymentJournalStrategy
      : this.vendorJournalStrategy;
    const journals = isPayment
      ? payload.paymentGroupedJournals!
      : (payload.groupedJournals ?? []);

    const errorCollector = new PostingErrorCollector();
    try {
      await this.executePosting(payload, strategy, journals, errorCollector);
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
    data: PostVendorJournalDFOJobPayload,
    strategy: IDfoPostingStrategy,
    journals: Array<{ header: unknown; lines: unknown[] }>,
    errorCollector: PostingErrorCollector,
  ): Promise<void> {
    const { batchId, company } = data;
    const createdHeaders: CreatedHeader[] = [];
    this.logger.log(
      `[POST] Starting sequential posting: ${journals.length} headers for batch ${batchId}`,
    );
    try {
      for (let i = 0; i < journals.length; i++) {
        await this.postOneGroup(
          strategy,
          journals[i],
          i + 1,
          journals.length,
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
          strategy,
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
    strategy: IDfoPostingStrategy,
    journal: { header: unknown; lines: unknown[] },
    index: number,
    total: number,
    company: string,
    createdHeaders: CreatedHeader[],
    _errorCollector: PostingErrorCollector,
  ): Promise<void> {
    const headerResult = await strategy.postHeadersInBatches(
      [journal.header],
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
    const postedLines = await strategy.postLinesForHeader(
      headerKey,
      journal.lines,
      company,
      LINE_CHUNK_SIZE,
    );
    this.logger.log(
      `[POST] Posted ${postedLines.length} lines for header ${index}`,
    );
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
