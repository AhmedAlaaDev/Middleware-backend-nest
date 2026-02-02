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
import { VendorJournalPostingStrategy } from '@/modules/queue/strategies/vendor-journal-posting.strategy';

const LINE_CHUNK_SIZE = 20;
const ROLLBACK_CHUNK_SIZE = 20;

@Processor(QUEUES.DFO_VENDOR_JOURNAL, { concurrency: 1 })
export class PostVendorJournalDFOProcessor extends WorkerHost {
  private readonly logger = new Logger(PostVendorJournalDFOProcessor.name);

  constructor(
    private readonly strategy: VendorJournalPostingStrategy,
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
    if (!payload.groupedJournals?.length) {
      throw new Error('No groupedJournals or empty');
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
    data: PostVendorJournalDFOJobPayload,
    errorCollector: PostingErrorCollector,
  ): Promise<void> {
    const { batchId, company, groupedJournals } = data;
    const createdHeaders: CreatedHeader[] = [];
    this.logger.log(
      `[POST] Starting sequential posting: ${groupedJournals.length} headers for batch ${batchId}`,
    );
    try {
      for (let i = 0; i < groupedJournals.length; i++) {
        await this.postOneGroup(
          groupedJournals[i],
          i + 1,
          groupedJournals.length,
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
    journal: PostVendorJournalDFOJobPayload['groupedJournals'][0],
    index: number,
    total: number,
    company: string,
    createdHeaders: CreatedHeader[],
    _errorCollector: PostingErrorCollector,
  ): Promise<void> {
    const headerResult = await this.strategy.postHeadersInBatches(
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
    const postedLines = await this.strategy.postLinesForHeader(
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
