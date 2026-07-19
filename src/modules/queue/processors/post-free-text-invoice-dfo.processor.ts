import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { dfoErrorMessage } from '@/modules/d365fo/errors/dfo-api.error';
import {
  FreeTextInvoiceLinePostError,
  type FreeTextInvoiceLinePostContext,
} from '@/modules/d365fo/errors/free-text-invoice-line-post.error';
import { FreeTextInvoiceFinTagService } from '@/modules/d365fo/services/free-text-invoice-fin-tag.service';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import {
  FreeTextInvoicePostingGroup,
  PostFreeTextInvoiceDFOJobPayload,
  type FreeTextInvoiceLinePostingMeta,
} from '@/modules/queue/contracts/post-free-text-invoice-dfo-job.contract';
import { QueueJobGroupStatus } from '@/modules/queue/schemas/queue-job-group.schema';
import {
  CreatedHeader,
  DfoRollbackService,
} from '@/modules/queue/services/dfo-rollback.service';
import { PostingErrorCollector } from '@/modules/queue/services/posting-error-collector.service';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';
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
    private readonly jobStore: QueueJobStoreService,
    private readonly operationalLogs: OperationalLoggerService,
    private readonly traceContext: TraceContextService,
  ) {
    super();
  }

  process(job: Job<PostFreeTextInvoiceDFOJobPayload>): Promise<void> {
    return this.traceContext.run(
      {
        correlationId: job.data.correlationId,
        batchId: job.data.batchId,
        jobId: String(job.id),
        queueName: QUEUES.DFO_FREE_TEXT_INVOICE,
      },
      () => this.processJob(job),
    );
  }

  private async processJob(
    job: Job<PostFreeTextInvoiceDFOJobPayload>,
  ): Promise<void> {
    const payload = job.data;
    const jobId = String(job.id);
    const errorCollector = new PostingErrorCollector();
    const legacyGroups = (
      job.data as PostFreeTextInvoiceDFOJobPayload & {
        groupedInvoices?: FreeTextInvoicePostingGroup[];
      }
    ).groupedInvoices;
    if (legacyGroups?.length) {
      await this.jobStore.prepare({
        ...job.data,
        correlationId: job.data.correlationId ?? job.data.batchId,
        payloadVersion: 1,
        jobId,
        queueName: QUEUES.DFO_FREE_TEXT_INVOICE,
        jobName: job.name,
        groups: legacyGroups,
      });
    }
    await this.jobStore.markActive(jobId, job.attemptsMade);
    await this.emitLifecycle('queue.job.active', 'active', jobId);
    try {
      await this.executePosting(job, errorCollector);
      await this.jobStore.markCompleted(jobId);
      await this.emitLifecycle('queue.job.completed', 'completed', jobId);
      this.logger.log(`Job ${job.id} completed successfully`);
    } catch (error) {
      const msg = dfoErrorMessage(error);
      if (!errorCollector.hasErrors()) {
        errorCollector.addHeaderError(msg, 'Job processing');
      }
      this.logger.error(
        `Job ${job.id} failed: ${msg}`,
        error instanceof Error ? error.stack : undefined,
      );
      const finalAttempt = this.isFinalAttempt(job);
      if (finalAttempt) {
        await this.jobStore.markFailed(jobId, msg);
        await this.handlePostingFailure(payload.batchId, errorCollector);
      } else {
        await this.jobStore.markRetrying(jobId, msg);
      }
      await this.emitLifecycle(
        finalAttempt ? 'queue.job.failed' : 'queue.job.retrying',
        finalAttempt ? 'failed' : 'retrying',
        jobId,
        error,
      );
      throw error;
    }
  }

  private async executePosting(
    job: Job<PostFreeTextInvoiceDFOJobPayload>,
    errorCollector: PostingErrorCollector,
  ): Promise<void> {
    const { batchId, company } = job.data;
    const jobId = String(job.id);
    const groups =
      await this.jobStore.listGroups<FreeTextInvoicePostingGroup>(jobId);
    if (!groups.length) throw new Error('No durable invoice groups found');
    const createdHeaders: CreatedHeader[] = [];
    this.logger.log(
      `[POST] Starting sequential posting: ${groups.length} headers for batch ${batchId}`,
    );
    try {
      for (const record of groups) {
        if (record.status === QueueJobGroupStatus.COMPLETED) continue;
        await this.jobStore.markGroupActive(jobId, record.index);
        await this.postOneGroup(
          record.payload,
          record.index,
          groups.length,
          company,
          createdHeaders,
          errorCollector,
          jobId,
          record.createdHeaderId,
        );
        await this.jobStore.completeGroup(jobId, record.index);
        await job.updateProgress({
          completedGroups: record.index + 1,
          totalGroups: groups.length,
        });
      }
      const headerKeys = [
        ...groups
          .map((group) => group.createdHeaderId)
          .filter((id): id is string => Boolean(id)),
        ...createdHeaders.map((h) => h.headerKey),
      ];
      await this.handlePostingSuccess(batchId, headerKeys);
    } catch (error) {
      const msg = dfoErrorMessage(error);
      this.logger.error(
        `[POST] Error for batch ${batchId}: ${msg}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (createdHeaders.length > 0) {
        this.logger.log(
          `[ROLLBACK] Rolling back ${createdHeaders.length} headers (headers only; D365FO cascades line deletion)`,
        );
        const headerResult = await this.dfoRollbackService.rollbackHeaders(
          this.strategy,
          createdHeaders.map((h) => h.headerKey),
          company,
          ROLLBACK_CHUNK_SIZE,
          errorCollector,
        );
        this.logger.log(
          `[ROLLBACK] Done: ${headerResult.successfullyDeleted.length} headers deleted, ${headerResult.failedToDelete.length} failed`,
        );
        if (headerResult.failedToDelete.length > 0) {
          await this.storeCreatedHeaderIds(
            batchId,
            headerResult.failedToDelete,
          );
        }
        await this.jobStore.resetAfterRollback(
          jobId,
          createdHeaders.map((header) => header.headerKey),
          headerResult.failedToDelete,
        );
      }
      throw error;
    }
  }

  private async postOneGroup(
    invoice: FreeTextInvoicePostingGroup,
    groupIndex: number,
    total: number,
    company: string,
    createdHeaders: CreatedHeader[],
    errorCollector: PostingErrorCollector,
    jobId: string,
    existingHeaderId?: string,
  ): Promise<void> {
    // console.log('--------------------------------');
    // console.log('INVOICE HEADER');
    // console.log(JSON.stringify(invoice.header, null, 2));
    // console.log('--------------------------------');
    // console.log('INVOICE LINES');
    // console.log(JSON.stringify(invoice.lines, null, 2));
    // console.log('--------------------------------');
    const index = groupIndex + 1;
    let headerKey = existingHeaderId;
    if (!headerKey) {
      const headerResult = await this.strategy.postHeadersInBatches(
        [invoice.header],
        1,
      );
      if (headerResult.headerIds.length !== 1) {
        throw new Error(
          `Expected 1 header ID, got ${headerResult.headerIds.length}`,
        );
      }
      headerKey = headerResult.headerIds[0];
      await this.jobStore.setCreatedHeader(jobId, groupIndex, headerKey);
    }
    createdHeaders.push({ headerKey, dataAreaId: company });
    this.logger.log(`[POST] Header ${index}/${total} created: ${headerKey}`);
    let postedLines: Array<{ headerId: string; lineNumber: number }>;
    try {
      postedLines = await this.strategy.postLinesForHeader(
        headerKey,
        invoice.lines,
        company,
        LINE_CHUNK_SIZE,
      );
    } catch (error) {
      if (error instanceof FreeTextInvoiceLinePostError) {
        const groupLabel = this.resolvePostingGroupLabel(invoice, index, total);
        const meta =
          invoice.linePostingMeta?.[error.context.lineIndexInInvoice];
        const detail = this.formatFreeTextLineFailureDetail(
          error.context,
          meta,
        );
        this.logger.error(
          `[POST] FreeTextNumber group "${groupLabel}" — ${error.message} | ${detail}`,
        );
        errorCollector.addLineError(
          error.message,
          `FreeTextNumber group: ${groupLabel}`,
        );
      }
      throw error;
    }
    this.logger.log(
      `[POST] Posted ${postedLines.length} lines for header ${index}`,
    );
    const finTagLines = this.buildFinTagLines(
      invoice,
      postedLines,
      index,
      total,
    );
    this.logger.log(
      `[FIN TAG] Updating financial tags for header ${headerKey}: ${JSON.stringify(
        {
          headerFinTagDisplayValue: invoice.HeaderFinTagDisplayValue,
          lineFinTagDisplayValues: invoice.LineFinTagDisplayValues,
          headerDefaultDimensionDisplayValue:
            invoice.HeaderDefaultDimensionDisplayValue,
          lines: finTagLines,
        },
      )}`,
    );
    try {
      await this.freeTextInvoiceFinTagService.updateFinTag(
        company,
        parseInt(headerKey, 10),
        invoice.HeaderFinTagDisplayValue,
        finTagLines,
      );
    } catch (err) {
      const msg = dfoErrorMessage(err);
      this.logger.error(
        `[FIN TAG] Fin tag update failed for ${headerKey}: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      errorCollector.addHeaderError(
        `Fin tag: ${msg}`,
        `Header ${index} fin tag`,
      );
      throw err;
    }
  }

  private buildFinTagLines(
    invoice: FreeTextInvoicePostingGroup,
    postedLines: Array<{ headerId: string; lineNumber: number }>,
    index: number,
    total: number,
  ): Array<{ lineNumber: number; tags: string }> {
    const groupLabel = this.resolvePostingGroupLabel(invoice, index, total);
    const lineFinTagDisplayValues = invoice.LineFinTagDisplayValues ?? [];
    const missingFields: string[] = [];

    if (!invoice.HeaderFinTagDisplayValue?.trim()) {
      missingFields.push('HeaderFinTagDisplayValue');
    }
    if (lineFinTagDisplayValues.length !== postedLines.length) {
      missingFields.push(
        `LineFinTagDisplayValues count ${lineFinTagDisplayValues.length} does not match posted line count ${postedLines.length}`,
      );
    }

    postedLines.forEach((postedLine, lineIndex) => {
      if (!lineFinTagDisplayValues[lineIndex]?.trim()) {
        missingFields.push(
          `LineFinTagDisplayValue for line ${postedLine.lineNumber}`,
        );
      }
    });

    if (missingFields.length > 0) {
      throw new Error(
        `Missing financial tag values for FreeTextNumber group "${groupLabel}": ${missingFields.join(', ')}`,
      );
    }

    return postedLines.map((postedLine, lineIndex) => ({
      lineNumber: postedLine.lineNumber,
      tags: lineFinTagDisplayValues[lineIndex],
    }));
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
      DataBatchStatus.Posted,
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

  private resolvePostingGroupLabel(
    invoice: FreeTextInvoicePostingGroup,
    index: number,
    total: number,
  ): string {
    const explicit = invoice.postingGroupLabel?.trim();
    if (explicit) {
      return explicit;
    }
    const ref = invoice.header?.CustomerReference?.trim();
    if (ref) {
      return ref;
    }
    return `invoice ${index}/${total}`;
  }

  private formatFreeTextLineFailureDetail(
    ctx: FreeTextInvoiceLinePostContext,
    meta: FreeTextInvoiceLinePostingMeta | undefined,
  ): string {
    const dim = ctx.defaultDimensionDisplayValue;
    const dimShort =
      dim && dim.length > 160 ? `${dim.slice(0, 160)}…` : (dim ?? '');
    const parts: string[] = [
      `lineIndexInInvoice=${ctx.lineIndexInInvoice}`,
      `chunk=${ctx.chunkNumber}`,
      `inChunkIndex=${ctx.indexInChunk}`,
      `LineNumber=${ctx.lineNumber}`,
      `BillingCode=${ctx.billingCode ?? ''}`,
      `MainAccount=${ctx.mainAccountDisplayValue ?? ''}`,
      `InvoiceText=${ctx.invoiceText ?? ''}`,
    ];
    if (dimShort) {
      parts.push(`DefaultDimension=${dimShort}`);
    }
    if (meta) {
      parts.push(`batchRecordId=${meta.batchRecordId}`);
      if (meta.dataModelType) {
        parts.push(`dataModelType=${meta.dataModelType}`);
      }
      if (meta.voucherInvoiceKey) {
        parts.push(`voucherInvoiceKey=${meta.voucherInvoiceKey}`);
      }
      if (meta.freeTextNumber) {
        parts.push(`freeTextNumber=${meta.freeTextNumber}`);
      }
      if (meta.billingClassification) {
        parts.push(`lineBillingClassification=${meta.billingClassification}`);
      }
      if (meta.billingCode) {
        parts.push(`dynBillingCode=${meta.billingCode}`);
      }
      if (meta.sourceIds?.length) {
        parts.push(`sourceIds=${meta.sourceIds.join(',')}`);
      }
    }
    return parts.join('; ');
  }

  private isFinalAttempt(job: Job): boolean {
    return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  }

  private emitLifecycle(
    eventType: string,
    status: string,
    jobId: string,
    error?: unknown,
  ): Promise<void> {
    return this.operationalLogs.emit({
      level: error ? 'error' : 'info',
      message: `Free-text invoice job ${jobId} ${status}`,
      context: PostFreeTextInvoiceDFOProcessor.name,
      eventType,
      status,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : undefined,
    });
  }
}
