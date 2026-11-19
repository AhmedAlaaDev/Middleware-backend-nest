import {
  INVOICE_REVIEW_FLOWS,
  InvoiceReviewFlow,
  InvoiceReviewFlowConfig,
} from './yard-invoice-flow';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import {
  YardInvoiceJobRecord,
  YardInvoiceJobStore,
} from './yard-invoice-job.store';
import { microToString } from './yard-invoice-decimal';
import { YardInvoiceGroup } from './yard-invoice-aggregation';
import { buildYardCashInSourceRows } from './yard-invoice-posting-adapter';
import { YardInvoiceGroupValidation } from './yard-invoice-validation';
import {
  YardInvoicePreviewService,
  YardInvoiceReview,
  YardInvoiceReviewLine,
  YardInvoiceSummary,
} from './yard-invoice-preview.service';
import { YardInvoiceJobStatus } from './yard-invoice-upload-job.schema';

import { PostCashBatchToDFOCommand } from '@/modules/cash/commands';
import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import {
  EntryDynDataModel,
  EntryRawDataModel,
} from '@/modules/entry-processor/models';

/** A job stuck in SUBMITTING or REVIEWING longer than this is reported for reconciliation. */
export const YARD_INVOICE_STALE_MS = 30 * 60 * 1000;

export interface YardInvoiceUser {
  id: string;
  role?: string;
}

export interface YardInvoiceJobView {
  jobId: string;
  company: string;
  fileName: string;
  status: YardInvoiceJobStatus | 'REVIEW_INTERRUPTED' | 'RECONCILE_REQUIRED';
  format: string | null;
  payloadHash: string | null;
  canSubmit: boolean;
  summary: YardInvoiceSummary | null;
  batchId: string | null;
  batchStatus: string | null;
  batchErrorCount: number;
  postingJobId: string | null;
  submissionStatus: string | null;
  /** Journal posting only. Yard receipts are unmarked, so invoices are not settled. */
  settlement: 'NOT_SETTLED_UNMARKED';
  lastError: string | null;
  correlationId: string;
}

export interface YardInvoiceLinesView {
  jobId: string;
  page: number;
  pageSize: number;
  total: number;
  items: (YardInvoiceReviewLine & { outcome: string })[];
}

/**
 * Upload job lifecycle: background review, durable state, and submit through
 * the existing Cash-In Yard processor, batch service and cash posting command.
 * Review and submit run in the background because a large file takes minutes;
 * the client polls the job. No posting route or D365 client is added here.
 */
@Injectable()
export class YardInvoiceSubmitService {
  constructor(
    private readonly store: YardInvoiceJobStore,
    private readonly preview: YardInvoicePreviewService,
    private readonly commandBus: CommandBus,
    private readonly dataBatchService: DataBatchService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly operationalLogs: OperationalLoggerService,
  ) {}

  /** Creates the job and starts the review in the background. */
  public async startReview(input: {
    fileBuffer: Buffer<ArrayBufferLike>;
    fileName: string;
    companyId: string;
    user: YardInvoiceUser;
    flow?: InvoiceReviewFlow;
  }): Promise<YardInvoiceJobView> {
    const flow: InvoiceReviewFlow = input.flow ?? 'YARD';
    const job = await this.store.create({
      company: input.companyId,
      createdByUserId: input.user.id,
      fileName: input.fileName,
      status: 'REVIEWING',
      correlationId: '',
      flow,
    });
    void this.runReview(
      job.id,
      input.fileBuffer,
      input.fileName,
      input.companyId,
      flow,
    );
    return this.getJob(job.id, input.user);
  }

  public async getJob(
    jobId: string,
    user: YardInvoiceUser,
  ): Promise<YardInvoiceJobView> {
    const job = await this.loadOwnedJob(jobId, user);
    const batch = job.batchId
      ? await this.dataBatchService.getByIdAsync(job.batchId)
      : null;
    const age = Date.now() - job.updatedAt.getTime();
    let status: YardInvoiceJobView['status'] = job.status;
    if (job.status === 'REVIEWING' && age > YARD_INVOICE_STALE_MS)
      status = 'REVIEW_INTERRUPTED';
    if (
      job.status === 'SUBMITTING' &&
      age > YARD_INVOICE_STALE_MS &&
      !job.batchId
    )
      status = 'RECONCILE_REQUIRED';
    return {
      jobId: job.id,
      company: job.company,
      fileName: job.fileName,
      status,
      format: job.format,
      payloadHash: job.payloadHash,
      canSubmit: job.canSubmit,
      summary: (job.summary as unknown as YardInvoiceSummary | null) ?? null,
      batchId: job.batchId,
      batchStatus: batch
        ? (DataBatchStatus[batch.status] ?? String(batch.status))
        : null,
      batchErrorCount: batch?.errorCount ?? 0,
      postingJobId: job.postingJobId,
      submissionStatus: job.submissionStatus,
      settlement: 'NOT_SETTLED_UNMARKED',
      lastError: job.lastError,
      correlationId: job.correlationId,
    };
  }

  /** One page of reviewed invoices, with the per-invoice outcome of the job. */
  public async getLines(
    jobId: string,
    user: YardInvoiceUser,
    page: number,
    pageSize: number,
  ): Promise<YardInvoiceLinesView> {
    const job = await this.loadOwnedJob(jobId, user);
    const view = await this.getJob(jobId, user);
    const result = await this.store.pageLines(jobId, page, pageSize);
    return {
      jobId,
      page,
      pageSize,
      total: result.total,
      items: result.items.map((line) => ({
        ...line,
        outcome:
          line.status !== 'VALID'
            ? 'BLOCKED'
            : invoiceOutcome(
                job.status,
                view.batchStatus,
                view.batchErrorCount,
              ),
      })),
    };
  }

  /**
   * Starts a submit. The job is claimed atomically (PREVIEWED, or a batch that
   * was never confirmed queued). The file is reviewed again in the background, the
   * payload hash must match the job, and only then is a batch created and queued.
   */
  public async submit(
    jobId: string,
    fileBuffer: Buffer<ArrayBufferLike>,
    user: YardInvoiceUser,
  ): Promise<YardInvoiceJobView> {
    const job = await this.loadOwnedJob(jobId, user);

    if (job.status === 'QUEUED') {
      return this.getJob(jobId, user);
    }
    if (
      job.status === 'REVIEWING' ||
      job.status === 'SUBMITTING' ||
      job.status === 'REVIEW_FAILED'
    ) {
      throw new ConflictException(
        `This upload is ${job.status.toLowerCase().replace('_', ' ')}; it cannot be submitted now.`,
      );
    }
    if (job.status === 'PREVIEWED' && !job.canSubmit) {
      throw new ConflictException(
        'The review found blocking issues. Upload a corrected workbook to review again.',
      );
    }

    const retryQueue =
      (job.status === 'BATCH_CREATED' || job.status === 'SUBMIT_FAILED') &&
      job.batchId !== null;
    const claimed = await this.store.claim(
      jobId,
      retryQueue ? ['BATCH_CREATED', 'SUBMIT_FAILED'] : ['PREVIEWED'],
      'SUBMITTING',
    );
    if (!claimed) {
      throw new ConflictException(
        'This upload is already being submitted or cannot be submitted.',
      );
    }

    if (retryQueue) {
      void this.enqueue(jobId, claimed.batchId as string);
    } else {
      void this.runSubmit(jobId, fileBuffer, claimed);
    }
    return this.getJob(jobId, user);
  }

  private async runReview(
    jobId: string,
    fileBuffer: Buffer<ArrayBufferLike>,
    fileName: string,
    company: string,
    flow: InvoiceReviewFlow,
  ): Promise<void> {
    try {
      const review = await this.preview.review({
        fileBuffer,
        fileName,
        companyId: company,
        maxTemplateRows: INVOICE_REVIEW_FLOWS[flow].maxTemplateRows,
      });
      if (flow === 'SHIPLINK' && review.format !== 'TEMPLATE_8') {
        throw new Error(
          'ShipLink invoice uploads accept the eight-column template only.',
        );
      }
      await this.storeReview(jobId, review);
      const batchId = await this.createReviewBatch(
        jobId,
        company,
        fileName,
        review,
        INVOICE_REVIEW_FLOWS[flow],
      );
      await this.store.update(jobId, { batchId });
    } catch (error) {
      await this.store.update(jobId, {
        status: 'REVIEW_FAILED',
        lastError: safeMessage(error, 'review could not complete'),
      });
      await this.operationalLogs.emit({
        level: 'warn',
        message: 'Yard invoice review failed',
        context: YardInvoiceSubmitService.name,
        eventType: 'yard_invoice.review',
        jobId,
        status: 'failed',
      });
    }
  }

  private async storeReview(
    jobId: string,
    review: YardInvoiceReview,
  ): Promise<void> {
    const summary = this.preview.toSummary(review);
    await this.store.replaceLines(jobId, this.preview.toLines(review));
    await this.store.update(jobId, {
      status: 'PREVIEWED',
      format: review.format,
      payloadHash: review.payloadHash,
      summary: summary as unknown as Record<string, unknown>,
      invoiceCount: review.groups.length,
      canSubmit: review.validation.canSubmit,
      correlationId: review.correlationId,
      lastError: null,
    });
    const canSubmit = review.validation.canSubmit;
    await this.operationalLogs.emit({
      level: canSubmit ? 'info' : 'warn',
      message: canSubmit
        ? `Yard invoice review ready: ${review.groups.length} invoice(s)`
        : `Yard invoice review blocked: ${summary.blockedInvoiceCount} of ${review.groups.length} invoice(s) blocked`,
      context: YardInvoiceSubmitService.name,
      eventType: 'yard_invoice.review',
      jobId,
      status: canSubmit ? 'validated' : 'blocked',
      metadata: {
        format: review.format,
        recordCount: summary.recordCount,
        invoiceCount: review.groups.length,
        blockedInvoiceCount: summary.blockedInvoiceCount,
        discrepancyCount: summary.discrepancyCount,
        creditNoteInvoiceCount: summary.creditNoteInvoiceCount,
        lookupFailedCount: summary.lookupFailedCount,
        canSubmit,
      },
    });
  }

  private async runSubmit(
    jobId: string,
    fileBuffer: Buffer<ArrayBufferLike>,
    job: YardInvoiceJobRecord,
  ): Promise<void> {
    let batchId: string | null = null;
    const config = INVOICE_REVIEW_FLOWS[job.flow ?? 'YARD'];
    try {
      const review = await this.preview.review({
        fileBuffer,
        fileName: job.fileName,
        companyId: job.company,
        maxTemplateRows: config.maxTemplateRows,
      });
      if (review.payloadHash !== job.payloadHash) {
        await this.store.update(jobId, {
          status: 'PREVIEWED',
          lastError:
            'the file or D365 data changed since review; review the upload again',
        });
        return;
      }
      if (!review.validation.canSubmit) {
        await this.storeReview(jobId, review);
        await this.store.update(jobId, {
          lastError:
            'the review found blocking issues; the upload was not submitted',
        });
        return;
      }

      const { rows } = buildYardCashInSourceRows(
        this.preview.toPostingInputs(review),
        config.receiptPrefix,
      );
      // The batch is created at review time; submit reuses it.
      batchId =
        job.batchId ??
        (await this.createBatch(jobId, job.company, rows, config));
      await this.store.update(jobId, {
        status: 'BATCH_CREATED',
        batchId,
        submittedAt: new Date(),
      });
    } catch (error) {
      if (!batchId) {
        await this.store.update(jobId, {
          status: 'PREVIEWED',
          lastError: safeMessage(error, 'submission could not start'),
        });
        return;
      }
      await this.store.update(jobId, {
        status: 'SUBMIT_FAILED',
        lastError: safeMessage(error, 'batch was created but not queued'),
      });
      return;
    }
    await this.enqueue(jobId, batchId);
  }

  private async enqueue(jobId: string, batchId: string): Promise<void> {
    try {
      const result = await this.commandBus.execute(
        new PostCashBatchToDFOCommand(batchId),
      );
      await this.store.update(jobId, {
        status: 'QUEUED',
        postingJobId: result.jobId,
        submissionStatus: result.submissionStatus,
      });
      await this.operationalLogs.emit({
        level: 'info',
        message: 'Yard invoice batch queued for D365 posting',
        context: YardInvoiceSubmitService.name,
        eventType: 'yard_invoice.submit',
        jobId,
        batchId,
        status: 'queued',
        metadata: { submissionStatus: result.submissionStatus },
      });
    } catch (error) {
      await this.store.update(jobId, {
        status: 'SUBMIT_FAILED',
        lastError: safeMessage(error, 'posting could not be queued'),
      });
      await this.operationalLogs.emit({
        level: 'error',
        message: 'Yard invoice batch could not be queued for D365 posting',
        context: YardInvoiceSubmitService.name,
        eventType: 'yard_invoice.submit',
        jobId,
        batchId,
        status: 'failed',
      });
    }
  }

  private async createBatch(
    jobId: string,
    company: string,
    rows: EntryRawDataModel[],
    config: InvoiceReviewFlowConfig,
  ): Promise<string> {
    const processor = this.processorFactory.getProcessorByName(
      config.processorType,
    );
    const enriched = (await processor.formatAndEnrichAsync(
      rows,
      company,
    )) as EntryDynDataModel[];
    const validated = (await processor.validateAsync(
      enriched,
      company,
    )) as EntryDynDataModel[];
    const lineErrors = validated.flatMap((line) => line.GetErrors());
    if (lineErrors.length > 0) {
      throw new Error(
        `Yard posting lines failed validation (${lineErrors.length}): ${lineErrors.slice(0, 3).join('; ')}`,
      );
    }
    const batch = await this.dataBatchService.createAsync(
      config.processorType,
      config.processorName,
      company,
      `${config.label} invoice job ${jobId}`,
      rows,
      validated,
      undefined,
      config.voucherLogicalName,
      { invoiceReviewFlow: config.flow },
    );
    return batch.id;
  }

  /**
   * Creates the standard Cash In batch for this upload when the review completes,
   * so the batch pages show it like the other Cash In types. One row per invoice.
   * Valid invoices are formatted exactly as before. Blocked invoices keep their
   * reasons as batch errors. The standard post refuses a batch with errors, so a
   * blocked invoice still cannot be posted.
   */
  private async createReviewBatch(
    jobId: string,
    company: string,
    fileName: string,
    review: YardInvoiceReview,
    config: InvoiceReviewFlowConfig,
  ): Promise<string> {
    const checks = new Map(
      review.validation.groups.map((check) => [check.invoiceNumber, check]),
    );
    const rows: EntryRawDataModel[] = [];
    const rowChecks: YardInvoiceGroupValidation[] = [];
    review.groups.forEach((group, index) => {
      const check = checks.get(group.invoiceNumber);
      if (!check) {
        throw new Error(
          `invoice ${group.invoiceNumber} is missing review data`,
        );
      }
      rowChecks.push(check);
      if (check.status === 'VALID' && check.metadata && check.offsetAccount) {
        rows.push(
          buildYardCashInSourceRows(
            [
              {
                group,
                metadata: check.metadata,
                offsetAccount: check.offsetAccount,
              },
            ],
            config.receiptPrefix,
          ).rows[0],
        );
      } else {
        rows.push(blockedReviewRow(group, index, check, config.receiptPrefix));
      }
    });

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.CashInYard,
    );
    const enriched = (await processor.formatAndEnrichAsync(
      rows,
      company,
    )) as EntryDynDataModel[];
    const validated = (await processor.validateAsync(
      enriched,
      company,
    )) as EntryDynDataModel[];
    if (validated.length !== rows.length) {
      throw new Error('Yard batch rows could not be matched to invoices');
    }
    validated.forEach((line, index) => {
      for (const message of rowChecks[index].errors) {
        line.AddError('Yard', message);
      }
    });

    const batch = await this.dataBatchService.createAsync(
      config.processorType,
      config.processorName,
      company,
      fileName,
      rows,
      validated,
      undefined,
      config.voucherLogicalName,
      { invoiceReviewFlow: config.flow },
    );
    const blockedInvoiceCount = rowChecks.filter(
      (check) => check.status === 'BLOCKED',
    ).length;
    await this.operationalLogs.emit({
      level: blockedInvoiceCount > 0 ? 'warn' : 'info',
      message: `Yard invoice batch created: ${rows.length} invoice(s), ${blockedInvoiceCount} blocked`,
      context: YardInvoiceSubmitService.name,
      eventType: 'yard_invoice.batch',
      jobId,
      batchId: batch.id,
      status: blockedInvoiceCount > 0 ? 'blocked' : 'validated',
      metadata: { invoiceCount: rows.length, blockedInvoiceCount },
    });
    return batch.id;
  }

  private async loadOwnedJob(
    jobId: string,
    user: YardInvoiceUser,
  ): Promise<YardInvoiceJobRecord> {
    const job = await this.store.findById(jobId);
    if (!job) throw new NotFoundException('Yard invoice upload job not found');
    if (
      job.createdByUserId !== user.id &&
      user.role?.toLowerCase() !== 'admin'
    ) {
      throw new ForbiddenException(
        'Only the uploader or an administrator can access this job.',
      );
    }
    return job;
  }
}

function invoiceOutcome(
  jobStatus: YardInvoiceJobStatus,
  batchStatus: string | null,
  errorCount: number,
): string {
  if (jobStatus === 'PREVIEWED') return 'READY_TO_SUBMIT';
  if (jobStatus === 'SUBMITTING') return 'SUBMITTING';
  if (jobStatus === 'SUBMIT_FAILED') return 'NOT_POSTED_RETRY';
  if (jobStatus === 'REVIEWING' || jobStatus === 'REVIEW_FAILED')
    return 'NOT_REVIEWED';
  if (errorCount > 0) return 'FAILED';
  switch (batchStatus) {
    case 'Posted':
      return 'POSTED';
    case 'Posting':
      return 'POSTING';
    case 'Canceled':
      return 'FAILED';
    case 'PendingPosting':
      return 'QUEUED';
    default:
      return 'PROCESSING';
  }
}

/**
 * Row for a blocked invoice. It has the same fields as a valid row; D365-derived
 * values are blank where the invoice could not be resolved. A blocked row is never
 * posted, because the batch holds errors.
 */
function blockedReviewRow(
  group: YardInvoiceGroup,
  index: number,
  check: YardInvoiceGroupValidation,
  receiptPrefix: string,
): EntryRawDataModel {
  const metadata = check.metadata;
  const offset = check.offsetAccount;
  return {
    UniqueId: index + 1,
    LINENUMBER: index + 1,
    TRANSDATE: group.paymentDate,
    DESCRIPTION: `${receiptPrefix}${group.invoiceNumber}`,
    ACCOUNTTYPE: 'Cust',
    ACCOUNTDISPLAYVALUE: metadata?.customerAccount ?? '',
    DEFAULTDIMENSIONDISPLAYVALUE: metadata?.defaultDimensionDisplayValue ?? '',
    FINTAGDISPLAYVALUE: metadata?.financialTagDisplayValue ?? '',
    OFFSETACCOUNTTYPE: offset?.accountType ?? '',
    OFFSETACCOUNTDISPLAYVALUE: group.safeBankAccount.trim(),
    OFFSETFINTAGDISPLAYVALUE: metadata?.financialTagDisplayValue ?? '',
    CURRENCYCODE: group.currencyCode,
    EXCHANGERATE: 0,
    CREDITAMOUNT: Number(microToString(group.roundedTotal)),
    DEBITAMOUNT: 0,
    INVOICE: group.invoiceNumber,
    PAYMENTID: group.paymentSerials[0] ?? '',
    PAYMENTREFERENCE: group.paymentReference,
    VOUCHERTYPE: group.paymentType,
    VoucherType: group.paymentType,
    SafeType: 'Customer Collection',
    DOCUMENT: '',
    DOCUMENTDATE: group.paymentDate,
    DUEDATE: '',
  } as unknown as EntryRawDataModel;
}

function safeMessage(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : '';
  return (text || fallback).slice(0, 500);
}
