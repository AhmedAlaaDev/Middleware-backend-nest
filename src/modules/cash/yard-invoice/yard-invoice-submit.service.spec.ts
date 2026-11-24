import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import {
  YardInvoiceAccountResolver,
  YardOffsetAccountResolution,
  offsetRequestKey,
} from './yard-invoice-account.resolver';
import { parseDecimalToMicro } from './yard-invoice-decimal';
import { YardInvoiceEnrichmentService } from './yard-invoice-enrichment.service';
import {
  NewYardInvoiceJob,
  YardInvoiceJobPatch,
  YardInvoiceJobRecord,
  YardInvoiceJobStore,
  YardInvoiceLinePage,
} from './yard-invoice-job.store';
import { YardInvoiceLookupResult } from './yard-invoice-lookup.types';
import {
  YardInvoicePreviewService,
  YardInvoiceReviewLine,
} from './yard-invoice-preview.service';
import {
  YARD_INVOICE_STALE_MS,
  YardInvoiceSubmitService,
} from './yard-invoice-submit.service';
import { YardInvoiceJobStatus } from './yard-invoice-upload-job.schema';
import {
  baseRow,
  buildTemplateWorkbook,
  TemplateFixtureRow,
} from './yard-invoice.test-helpers';

import { PostCashBatchToDFOCommand } from '@/modules/cash/commands';
import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';

/** In-memory store with the same atomic claim semantics as the Mongo adapter. */
class MemoryJobStore extends YardInvoiceJobStore {
  readonly records = new Map<string, YardInvoiceJobRecord>();
  readonly lines = new Map<string, YardInvoiceReviewLine[]>();
  private seq = 0;

  create(record: NewYardInvoiceJob): Promise<YardInvoiceJobRecord> {
    const created: YardInvoiceJobRecord = {
      id: `job-${++this.seq}`,
      company: record.company,
      createdByUserId: record.createdByUserId,
      fileName: record.fileName,
      format: null,
      payloadHash: null,
      status: record.status,
      summary: null,
      invoiceCount: 0,
      canSubmit: false,
      batchId: null,
      postingJobId: null,
      submissionStatus: null,
      lastError: null,
      correlationId: record.correlationId,
      submittedAt: null,
      updatedAt: new Date(),
    };
    this.records.set(created.id, created);
    return Promise.resolve({ ...created });
  }
  findById(id: string): Promise<YardInvoiceJobRecord | null> {
    const r = this.records.get(id);
    return Promise.resolve(r ? { ...r } : null);
  }
  claim(
    id: string,
    from: YardInvoiceJobStatus[],
    to: YardInvoiceJobStatus,
  ): Promise<YardInvoiceJobRecord | null> {
    const r = this.records.get(id);
    if (!r || !from.includes(r.status)) return Promise.resolve(null);
    r.status = to;
    r.updatedAt = new Date();
    return Promise.resolve({ ...r });
  }
  update(id: string, patch: YardInvoiceJobPatch): Promise<void> {
    const r = this.records.get(id);
    if (!r) return Promise.reject(new Error('missing job'));
    Object.assign(r, patch, { updatedAt: new Date() });
    return Promise.resolve();
  }
  replaceLines(jobId: string, lines: YardInvoiceReviewLine[]): Promise<void> {
    this.lines.set(jobId, lines);
    return Promise.resolve();
  }
  pageLines(
    jobId: string,
    page: number,
    pageSize: number,
  ): Promise<YardInvoiceLinePage> {
    const all = this.lines.get(jobId) ?? [];
    return Promise.resolve({
      total: all.length,
      items: all.slice((page - 1) * pageSize, page * pageSize),
    });
  }
}

const ACCOUNT_OK: YardOffsetAccountResolution = {
  status: 'OK',
  accountType: 'Petty cash',
  accountDisplayValue: 'Yard Safe',
  message: '',
  retryable: false,
};

const FOUND = (invoice: string): YardInvoiceLookupResult => ({
  status: 'FOUND',
  metadata: {
    invoiceNumber: invoice,
    company: 'm-p',
    invoiceIdentifier: '1',
    customerAccount: 'C-100',
    currencyCode: 'EGP',
    defaultDimensionDisplayValue: '|2401|024',
    financialTagDisplayValue: 'TAG-A',
    voucher: `V-${invoice}`,
    openBalance: parseDecimalToMicro('10000'),
  },
});

const USER = { id: 'user-1', role: 'user' };

/** Records operational events so tests can assert what the Observability page receives. */
const operationalLogs = {
  emit: jest.fn().mockResolvedValue(undefined),
};

async function waitFor(
  predicate: () => boolean,
  attempts = 2000,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition not reached');
}

async function setup(
  options: {
    rows?: TemplateFixtureRow[];
    account?: YardOffsetAccountResolution;
    pollBatchStatus?: DataBatchStatus;
    processorErrors?: string[];
  } = {},
) {
  const store = new MemoryJobStore();
  const state: {
    lookup: (inv: string) => YardInvoiceLookupResult;
    account: YardOffsetAccountResolution;
  } = { lookup: FOUND, account: options.account ?? ACCOUNT_OK };
  const enrichment = {
    resolveInvoices: jest.fn((_c: string, invoices: string[]) =>
      Promise.resolve(new Map(invoices.map((inv) => [inv, state.lookup(inv)]))),
    ),
  } as unknown as YardInvoiceEnrichmentService;
  const accounts = {
    resolveMany: jest.fn(
      (_c: string, requests: Parameters<typeof offsetRequestKey>[0][]) =>
        Promise.resolve(
          new Map(requests.map((r) => [offsetRequestKey(r), state.account])),
        ),
    ),
  } as unknown as YardInvoiceAccountResolver;
  const preview = new YardInvoicePreviewService(enrichment, accounts);

  const processorState: { errors: string[] } = {
    errors: options.processorErrors ?? [],
  };
  const processor = {
    formatAndEnrichAsync: jest.fn((rows: Record<string, unknown>[]) =>
      Promise.resolve(
        rows.map((row) => ({ ...row, GetErrors: () => [] as string[] })),
      ),
    ),
    validateAsync: jest.fn((lines: Record<string, unknown>[]) =>
      Promise.resolve(
        lines.map((l) => ({
          ...l,
          GetErrors: () => processorState.errors,
          AddError: () => undefined,
        })),
      ),
    ),
  };
  const processorFactory = {
    getProcessorByName: jest.fn((type: EntryProcessorTypes) => {
      expect(type).toBe(EntryProcessorTypes.CashInYard);
      return processor;
    }),
  };
  const dataBatchService = {
    createAsync: jest.fn(() => Promise.resolve({ id: 'batch-1' })),
    getByIdAsync: jest.fn(() =>
      Promise.resolve({
        id: 'batch-1',
        status: options.pollBatchStatus ?? DataBatchStatus.PendingPosting,
        errorCount: 0,
      }),
    ),
  };
  const commandBus = {
    execute: jest.fn((_command: unknown) =>
      Promise.resolve({
        jobId: 'post-1',
        message: 'queued',
        submissionStatus: 'queued',
      }),
    ),
  };

  const service = new YardInvoiceSubmitService(
    store,
    preview,
    commandBus as never,
    dataBatchService as never,
    processorFactory as never,
    operationalLogs as never,
  );

  const buffer = await buildTemplateWorkbook(
    options.rows ?? [
      baseRow({
        PaymentSerial: 'PS-1',
        'PaymentNet Total': '1350.0001',
        InvoiceNumber: '000061156/YD',
      }),
      baseRow({
        PaymentSerial: 'PS-2',
        'PaymentNet Total': '100',
        InvoiceNumber: '000061156/YD',
      }),
      baseRow({
        PaymentSerial: 'PS-3',
        'PaymentNet Total': '50',
        InvoiceNumber: '000061157/YD',
      }),
    ],
  );

  const started = await service.startReview({
    fileBuffer: buffer,
    fileName: 'Yards-Shiplink.xlsx',
    companyId: 'm-p',
    user: USER,
  });
  await waitFor(
    () =>
      store.records.get(started.jobId)?.status === 'PREVIEWED' ||
      store.records.get(started.jobId)?.status === 'REVIEW_FAILED',
  );

  return {
    service,
    store,
    buffer,
    jobId: started.jobId,
    state,
    processorState,
    processor,
    dataBatchService,
    commandBus,
    accounts,
    enrichment,
  };
}

describe('YardInvoiceSubmitService: background review', () => {
  it('starts a review in the background and stores the summary, lines and payload hash', async () => {
    const ctx = await setup();
    const job = ctx.store.records.get(ctx.jobId)!;
    expect(job).toMatchObject({
      status: 'PREVIEWED',
      format: 'TEMPLATE_8',
      canSubmit: true,
      invoiceCount: 2,
    });
    expect(job.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ctx.store.lines.get(ctx.jobId)).toHaveLength(2);
  });

  it('emits an observability event for the review result, tied to the job', async () => {
    operationalLogs.emit.mockClear();
    const ctx = await setup();
    expect(operationalLogs.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'yard_invoice.review',
        jobId: ctx.jobId,
        status: 'validated',
        level: 'info',
        metadata: expect.objectContaining({
          invoiceCount: 2,
          canSubmit: true,
        }),
      }),
    );
  });

  it('returns a page of lines with the per-invoice outcome', async () => {
    const ctx = await setup();
    const page = await ctx.service.getLines(ctx.jobId, USER, 1, 1);
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ outcome: 'READY_TO_SUBMIT' });
  });

  it('records a review that fails to read as REVIEW_FAILED with a safe message', async () => {
    const store = new MemoryJobStore();
    const preview = {
      review: jest.fn(() => Promise.reject(new Error('unsupported workbook'))),
    } as unknown as YardInvoicePreviewService;
    const service = new YardInvoiceSubmitService(
      store,
      preview,
      {} as never,
      {} as never,
      {} as never,
      operationalLogs as never,
    );
    const view = await service.startReview({
      fileBuffer: Buffer.from('x'),
      fileName: 'bad.xlsx',
      companyId: 'm-p',
      user: USER,
    });
    expect(view.status).toBe('REVIEWING');
    await waitFor(
      () => store.records.get(view.jobId)?.status === 'REVIEW_FAILED',
    );
    expect(store.records.get(view.jobId)?.lastError).toBe(
      'unsupported workbook',
    );
  });

  it('reports a stale review as REVIEW_INTERRUPTED', async () => {
    const ctx = await setup();
    ctx.store.records.get(ctx.jobId)!.status = 'REVIEWING';
    ctx.store.records.get(ctx.jobId)!.updatedAt = new Date(
      Date.now() - YARD_INVOICE_STALE_MS - 60_000,
    );
    expect((await ctx.service.getJob(ctx.jobId, USER)).status).toBe(
      'REVIEW_INTERRUPTED',
    );
  });
});

describe('YardInvoiceSubmitService: empty uploads', () => {
  it('does not create or queue a batch from a workbook with no transaction rows', async () => {
    const ctx = await setup({ rows: [] });
    const job = ctx.store.records.get(ctx.jobId)!;
    expect(job).toMatchObject({
      status: 'REVIEW_FAILED',
      lastError: 'No transaction rows found.',
      batchId: null,
    });
    expect(ctx.store.lines.get(ctx.jobId) ?? []).toHaveLength(0);
    expect(ctx.dataBatchService.createAsync).not.toHaveBeenCalled();
    expect(ctx.commandBus.execute).not.toHaveBeenCalled();
  });
});

describe('YardInvoiceSubmitService: submit', () => {
  it('creates one batch from the reviewed file, sums same-invoice rows and queues it through the existing command', async () => {
    const ctx = await setup();
    const started = await ctx.service.submit(ctx.jobId, ctx.buffer, USER);
    expect(started.status).toBe('SUBMITTING');
    await waitFor(() => ctx.store.records.get(ctx.jobId)?.status === 'QUEUED');

    expect(ctx.dataBatchService.createAsync).toHaveBeenCalledTimes(1);
    const args = ctx.dataBatchService.createAsync.mock.calls[0] as unknown[];
    expect(args[0]).toBe(EntryProcessorTypes.CashInYard);
    const rows = args[4] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      INVOICE: '000061156/YD',
      CREDITAMOUNT: 1450,
      OFFSETACCOUNTTYPE: 'Petty cash',
    });
    expect(ctx.commandBus.execute).toHaveBeenCalledTimes(1);
    expect(
      (ctx.commandBus.execute.mock.calls[0][0] as PostCashBatchToDFOCommand)
        .batchId,
    ).toBe('batch-1');
    expect(ctx.store.records.get(ctx.jobId)).toMatchObject({
      batchId: 'batch-1',
      postingJobId: 'post-1',
    });
  });

  it('does not create a second batch or queue again when the job was already submitted', async () => {
    const ctx = await setup();
    await ctx.service.submit(ctx.jobId, ctx.buffer, USER);
    await waitFor(() => ctx.store.records.get(ctx.jobId)?.status === 'QUEUED');
    const again = await ctx.service.submit(ctx.jobId, ctx.buffer, USER);
    expect(again.status).toBe('QUEUED');
    expect(ctx.dataBatchService.createAsync).toHaveBeenCalledTimes(1);
    expect(ctx.commandBus.execute).toHaveBeenCalledTimes(1);
  });

  it('lets exactly one of two concurrent submits start', async () => {
    const ctx = await setup();
    const results = await Promise.allSettled([
      ctx.service.submit(ctx.jobId, ctx.buffer, USER),
      ctx.service.submit(ctx.jobId, ctx.buffer, USER),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === 'rejected')
        .every((r) => r.reason instanceof ConflictException),
    ).toBe(true);
    await waitFor(() => ctx.store.records.get(ctx.jobId)?.status === 'QUEUED');
    expect(ctx.dataBatchService.createAsync).toHaveBeenCalledTimes(1);
  });

  it('refuses to submit a review that the server marked as not submittable (synchronous conflict)', async () => {
    const ctx = await setup({
      account: { ...ACCOUNT_OK, status: 'INACTIVE', message: 'inactive' },
    });
    await waitFor(() => Boolean(ctx.store.records.get(ctx.jobId)?.batchId));
    await expect(
      ctx.service.submit(ctx.jobId, ctx.buffer, USER),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.dataBatchService.createAsync).toHaveBeenCalledTimes(1);
  });

  it('refuses a changed file: the job returns to PREVIEWED with a message and no batch is created', async () => {
    const ctx = await setup();
    const changed = await buildTemplateWorkbook([
      baseRow({
        PaymentSerial: 'PS-1',
        'PaymentNet Total': '999',
        InvoiceNumber: '000061156/YD',
      }),
    ]);
    await ctx.service.submit(ctx.jobId, changed, USER);
    await waitFor(
      () =>
        ctx.store.records.get(ctx.jobId)?.status === 'PREVIEWED' &&
        ctx.store.records.get(ctx.jobId)?.lastError !== null,
    );
    expect(ctx.store.records.get(ctx.jobId)?.lastError).toMatch(
      /changed since review/,
    );
    expect(ctx.dataBatchService.createAsync).toHaveBeenCalledTimes(1);
  });

  it('refuses a change in D365 metadata after review (the payload hash covers resolved values)', async () => {
    const ctx = await setup();
    ctx.state.lookup = (inv) => {
      const ok = FOUND(inv);
      return ok.status === 'FOUND'
        ? {
            status: 'FOUND',
            metadata: { ...ok.metadata, financialTagDisplayValue: 'TAG-B' },
          }
        : ok;
    };
    await ctx.service.submit(ctx.jobId, ctx.buffer, USER);
    await waitFor(() => ctx.store.records.get(ctx.jobId)?.lastError !== null);
    expect(ctx.dataBatchService.createAsync).toHaveBeenCalledTimes(1);
    expect(ctx.store.records.get(ctx.jobId)?.status).toBe('PREVIEWED');
  });

  it('keeps the job reviewable and records processor line errors on the batch as errors', async () => {
    const ctx = await setup({
      processorErrors: [
        'AccountDisplayValue: customer ACCOUNTDISPLAYVALUE is required.',
      ],
    });
    expect(ctx.store.records.get(ctx.jobId)?.batchId).toBeTruthy();
    expect(ctx.store.records.get(ctx.jobId)?.status).toBe('PREVIEWED');
    expect(ctx.store.records.get(ctx.jobId)?.lastError).toBeNull();
    expect(ctx.dataBatchService.createAsync).toHaveBeenCalledTimes(1);
    expect(ctx.commandBus.execute).not.toHaveBeenCalled();
  });

  it('marks SUBMIT_FAILED when queueing fails, and a retry re-queues the same batch', async () => {
    const ctx = await setup();
    ctx.commandBus.execute.mockImplementationOnce(() =>
      Promise.reject(new Error('queue unavailable')),
    );
    await ctx.service.submit(ctx.jobId, ctx.buffer, USER);
    await waitFor(
      () => ctx.store.records.get(ctx.jobId)?.status === 'SUBMIT_FAILED',
    );
    expect(ctx.store.records.get(ctx.jobId)?.batchId).toBe('batch-1');

    await ctx.service.submit(ctx.jobId, ctx.buffer, USER);
    await waitFor(() => ctx.store.records.get(ctx.jobId)?.status === 'QUEUED');
    expect(ctx.dataBatchService.createAsync).toHaveBeenCalledTimes(1);
    expect(ctx.commandBus.execute).toHaveBeenCalledTimes(2);
    expect(
      (ctx.commandBus.execute.mock.calls[1][0] as PostCashBatchToDFOCommand)
        .batchId,
    ).toBe('batch-1');
  });

  it('re-queues a batch left in BATCH_CREATED by an interrupted submit, without creating another batch', async () => {
    const ctx = await setup();
    ctx.store.records.get(ctx.jobId)!.status = 'BATCH_CREATED';
    ctx.store.records.get(ctx.jobId)!.batchId = 'batch-1';
    await ctx.service.submit(ctx.jobId, ctx.buffer, USER);
    await waitFor(() => ctx.store.records.get(ctx.jobId)?.status === 'QUEUED');
    expect(ctx.dataBatchService.createAsync).toHaveBeenCalledTimes(1);
    expect(ctx.commandBus.execute).toHaveBeenCalledTimes(1);
  });

  it('reports RECONCILE_REQUIRED for a submit stuck in SUBMITTING with no batch, and refuses to submit it', async () => {
    const ctx = await setup();
    const record = ctx.store.records.get(ctx.jobId)!;
    record.status = 'SUBMITTING';
    record.batchId = null;
    record.updatedAt = new Date(Date.now() - YARD_INVOICE_STALE_MS - 60_000);
    expect((await ctx.service.getJob(ctx.jobId, USER)).status).toBe(
      'RECONCILE_REQUIRED',
    );
    await expect(
      ctx.service.submit(ctx.jobId, ctx.buffer, USER),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.dataBatchService.createAsync).toHaveBeenCalledTimes(1);
  });

  it('shows POSTED per invoice only when the batch reports Posted with no errors, and never settlement', async () => {
    const ctx = await setup({ pollBatchStatus: DataBatchStatus.Posted });
    await ctx.service.submit(ctx.jobId, ctx.buffer, USER);
    await waitFor(() => ctx.store.records.get(ctx.jobId)?.status === 'QUEUED');
    const page = await ctx.service.getLines(ctx.jobId, USER, 1, 10);
    expect(page.items.every((item) => item.outcome === 'POSTED')).toBe(true);
    const job = await ctx.service.getJob(ctx.jobId, USER);
    expect(job).toMatchObject({
      batchStatus: 'Posted',
      settlement: 'NOT_SETTLED_UNMARKED',
    });
  });

  it('enforces ownership: another user is forbidden, an administrator is allowed', async () => {
    const ctx = await setup();
    await expect(
      ctx.service.getJob(ctx.jobId, { id: 'someone-else', role: 'user' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      ctx.service.getJob(ctx.jobId, { id: 'admin-9', role: 'ADMIN' }),
    ).resolves.toMatchObject({ jobId: ctx.jobId });
    await expect(
      ctx.service.submit(ctx.jobId, ctx.buffer, {
        id: 'someone-else',
        role: 'user',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.dataBatchService.createAsync).toHaveBeenCalledTimes(1);
  });

  it('returns NotFound for an unknown job', async () => {
    const ctx = await setup();
    await expect(ctx.service.getJob('missing', USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
