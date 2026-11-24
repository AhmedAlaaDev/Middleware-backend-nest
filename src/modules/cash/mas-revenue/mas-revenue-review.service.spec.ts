/* eslint-disable @typescript-eslint/require-await */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import ExcelJS from 'exceljs';

import {
  emptyMasRevenueConfig,
  type MasRevenueVerifiedConfig,
} from './mas-revenue-config';
import { MasRevenueConfigProvider } from './mas-revenue-config.provider';
import { buildMasRevenueGlLines } from './mas-revenue-gl-body.builder';
import {
  MasRevenueReviewService,
  MasRevenueUser,
} from './mas-revenue-review.service';
import {
  MasRevenueClaimResult,
  MasRevenueReviewLineRecord,
  MasRevenueReviewRecord,
  MasRevenueReviewStore,
  NewMasRevenueReceiptClaim,
  NewMasRevenueReview,
} from './mas-revenue-review.store';
import { MasRevenueStoredRaw, storedRawToReceipt } from './mas-revenue-stored';
import { buildMasRevenueTemplate } from './mas-revenue-template';
import {
  MAS_REVENUE_HEADERS,
  MAS_REVENUE_SHEET_NAME,
  MAS_REVENUE_TEMPLATE_COLUMNS,
} from './mas-revenue.constants';
import { completeMasRevenueConfig } from './mas-revenue.test-fixtures';

import { CashInMasRevenueEntryProcessor } from '@/modules/cash/processors/inbound/mas-revenue/cash-in-mas-revenue-entry.processor';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';

const HEADERS = MAS_REVENUE_TEMPLATE_COLUMNS.map(
  (field) => MAS_REVENUE_HEADERS[field],
);
const CASH = 'خزينة بور سعيد مصري';
const OWNER: MasRevenueUser = { id: 'user-1', role: 'user' };
const OTHER: MasRevenueUser = { id: 'user-2', role: 'user' };

function completeConfig(): MasRevenueVerifiedConfig {
  return completeMasRevenueConfig();
}

async function workbookWithRows(rows: Array<Array<unknown>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(MAS_REVENUE_SHEET_NAME);
  sheet.addRow(HEADERS);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function receiptRow(
  invoice: string,
  overrides: Partial<Record<number, unknown>> = {},
): unknown[] {
  const row: unknown[] = [
    '2026-10-28',
    invoice,
    1600,
    224,
    1824,
    '20DC',
    'شركة اختبار',
    '100000001',
    'ABCU1234567',
    'BL000001',
    'In',
    'Example Line',
    CASH,
    null,
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

/** In-memory store with the same contract as the MongoDB store. */
class FakeStore extends MasRevenueReviewStore {
  reviews = new Map<string, MasRevenueReviewRecord>();
  lines: MasRevenueReviewLineRecord[] = [];
  private seq = 0;

  async createReview(
    review: NewMasRevenueReview,
  ): Promise<MasRevenueReviewRecord> {
    this.seq += 1;
    const record: MasRevenueReviewRecord = {
      ...review,
      id: `review-${this.seq}`,
      status: 'PREVIEWED',
      batchId: null,
      submitKey: null,
      lastError: null,
      submittedAt: null,
      createdAt: new Date(0),
    };
    this.reviews.set(record.id, record);
    return { ...record };
  }
  async insertLines(lines: MasRevenueReviewLineRecord[]): Promise<void> {
    this.lines.push(...lines);
  }
  async findReview(id: string) {
    const r = this.reviews.get(id);
    return r ? { ...r } : null;
  }
  async updateReview(
    id: string,
    patch: Partial<MasRevenueReviewRecord>,
  ): Promise<void> {
    const current = this.reviews.get(id);
    if (current) this.reviews.set(id, { ...current, ...patch });
  }
  async claimReview(
    id: string,
    from: string[],
    to: MasRevenueReviewRecord['status'],
    submitKey: string | null,
  ) {
    const current = this.reviews.get(id);
    if (!current || !from.includes(current.status)) return null;
    const next = {
      ...current,
      status: to,
      ...(submitKey ? { submitKey } : {}),
    };
    this.reviews.set(id, next);
    return { ...next };
  }
  async findLines(reviewId: string) {
    return this.lines
      .filter((l) => l.reviewId === reviewId)
      .sort((a, b) => a.position - b.position);
  }
  async pageLines(reviewId: string, page: number, pageSize: number) {
    const all = await this.findLines(reviewId);
    return {
      total: all.length,
      items: all.slice((page - 1) * pageSize, page * pageSize),
    };
  }
  /** Claims of the identity table. Unique on identity and on PaymentId base, like the indexes. */
  claims: Array<
    NewMasRevenueReceiptClaim & { reviewId: string; batchId: string | null }
  > = [];
  /** Test hook: invoked once per claim attempt, before the state is checked. */
  beforeClaim: (() => Promise<void>) | null = null;

  async findSubmittedReceiptLines(company: string, invoiceNumbers: string[]) {
    return this.lines
      .filter(
        (l) =>
          l.company === company &&
          Boolean(l.batchId) &&
          invoiceNumbers.includes(l.invoiceNumber),
      )
      .map((l) => ({ ...l }));
  }
  async findReceiptClaims(company: string, invoiceNumbers: string[]) {
    return this.claims
      .filter(
        (c) =>
          c.company === company && invoiceNumbers.includes(c.invoiceNumber),
      )
      .map((c) => ({ ...c }));
  }
  async claimReceiptIdentities(
    reviewId: string,
    claims: NewMasRevenueReceiptClaim[],
  ): Promise<MasRevenueClaimResult> {
    if (this.beforeClaim) await this.beforeClaim();
    // Check and insert in one synchronous block, as a unique index does in the database.
    const batchKeys = new Set<string>();
    for (const claim of claims) {
      if (
        this.claims.some(
          (c) =>
            c.company === claim.company && c.identityKey === claim.identityKey,
        ) ||
        batchKeys.has(`id:${claim.identityKey}`)
      ) {
        return { ok: false, reason: 'IDENTITY_TAKEN' };
      }
      if (
        this.claims.some(
          (c) =>
            c.company === claim.company &&
            c.paymentIdBase === claim.paymentIdBase,
        ) ||
        batchKeys.has(`pid:${claim.paymentIdBase}`)
      ) {
        return { ok: false, reason: 'PAYMENT_ID_TAKEN' };
      }
      batchKeys.add(`id:${claim.identityKey}`);
      batchKeys.add(`pid:${claim.paymentIdBase}`);
    }
    this.claims.push(...claims.map((c) => ({ ...c, reviewId, batchId: null })));
    return { ok: true };
  }
  async releaseUnbatchedReceiptClaims(reviewId: string): Promise<void> {
    this.claims = this.claims.filter(
      (c) => !(c.reviewId === reviewId && c.batchId === null),
    );
  }
  async releaseBatchReceipts(batchId: string): Promise<void> {
    this.claims = this.claims.filter((c) => c.batchId !== batchId);
    this.lines = this.lines.map((l) =>
      l.batchId === batchId ? { ...l, batchId: null } : l,
    );
  }
  async attachBatchToReceiptClaims(
    reviewId: string,
    batchId: string,
  ): Promise<void> {
    this.claims = this.claims.map((c) =>
      c.reviewId === reviewId ? { ...c, batchId } : c,
    );
  }
  async markLinesSubmitted(reviewId: string, batchId: string): Promise<void> {
    this.lines = this.lines.map((l) =>
      l.reviewId === reviewId ? { ...l, batchId } : l,
    );
  }
}

function buildService(config: MasRevenueVerifiedConfig) {
  const store = new FakeStore();
  const configProvider = {
    current: () => ({ config, source: 'test' }),
  } as unknown as MasRevenueConfigProvider;
  const dataBatchService = {
    createAsync: jest.fn(async (..._args: unknown[]) => ({ id: 'batch-1' })),
    getByIdAsync: jest.fn(
      async (id: string) => ({ id }) as { id: string } | null,
    ),
  };
  const processor = new CashInMasRevenueEntryProcessor({} as never);
  const processorFactory = {
    getProcessorByName: jest.fn((type: EntryProcessorTypes) => {
      if (type !== EntryProcessorTypes.CashInMasRevenue)
        throw new Error('unexpected processor');
      return processor;
    }),
  };
  const operationalLogs = { emit: jest.fn(async () => undefined) };
  const cashVerifier = {
    verify: jest.fn(
      async (
        ids: string[],
      ): Promise<
        Array<{
          id: string;
          status: string;
          currency: string | null;
          error: string | null;
        }>
      > =>
        ids.map((id) => ({
          id,
          status: 'RCASH',
          currency: 'EGP',
          error: null,
        })),
    ),
  };
  const service = new MasRevenueReviewService(
    store,
    configProvider,
    dataBatchService as never,
    processorFactory as never,
    operationalLogs as never,
    cashVerifier as never,
  );
  return { service, store, dataBatchService, processorFactory, cashVerifier };
}

async function previewValid(
  service: MasRevenueReviewService,
  rows: unknown[][] = [receiptRow('0012')],
) {
  return service.preview({
    fileBuffer: await workbookWithRows(rows),
    fileName: 'upload.xlsx',
    companyId: 'mas',
    templateVersion: 1,
    user: OWNER,
  });
}

function submitBody(payloadHash: string, key = 'key-1') {
  return { reviewVersion: 1, payloadHash, idempotencyKey: key };
}

describe('MasRevenueReviewService.preview', () => {
  it('stores a snapshot and creates no batch and no D365 write', async () => {
    const { service, dataBatchService, store } = buildService(completeConfig());
    const view = await previewValid(service);

    expect(view.uploadValid).toBe(true);
    expect(view.receiptCount).toBe(1);
    expect(dataBatchService.createAsync).not.toHaveBeenCalled();
    expect(store.reviews.size).toBe(1);
    expect(store.lines).toHaveLength(1);
  });

  it('lists configuration blockers; a valid upload can still create its batch (posting is gated)', async () => {
    const { service } = buildService(emptyMasRevenueConfig());
    const view = await previewValid(service);
    expect(view.uploadValid).toBe(true);
    expect(view.canSubmit).toBe(true);
    expect(view.blockers.join(' ')).toMatch(/GL JournalName is not configured/);
  });

  it('refuses a company other than mas', async () => {
    const { service } = buildService(completeConfig());
    await expect(
      service.preview({
        fileBuffer: await workbookWithRows([receiptRow('1')]),
        fileName: 'x.xlsx',
        companyId: 'm-p',
        templateVersion: 1,
        user: OWNER,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses an unsupported template version', async () => {
    const { service } = buildService(completeConfig());
    await expect(
      service.preview({
        fileBuffer: await workbookWithRows([receiptRow('1')]),
        fileName: 'x.xlsx',
        companyId: 'mas',
        templateVersion: 2,
        user: OWNER,
      }),
    ).rejects.toThrow(/templateVersion 2 is not supported/);
  });

  it('takes the receipt currency from its verified D365 cash account', async () => {
    const { service, store } = buildService(completeConfig());
    await previewValid(service);
    const currencies = [...store.lines].map((line) => line.raw.Currency);
    expect(currencies).toEqual(['EGP']);
  });

  it('resolves the currency of an unmapped cash account by looking up its sheet value in D365', async () => {
    const { service, store, cashVerifier } = buildService(
      emptyMasRevenueConfig(),
    );
    const view = await previewValid(service);
    expect(cashVerifier.verify).toHaveBeenCalledWith([CASH]);
    expect([...store.lines].map((line) => line.raw.Currency)).toEqual(['EGP']);
    expect(view.blockers.join(' ')).not.toContain(
      'currency is not resolved from D365',
    );
  });

  it('creates the batch without error lines, and names the cash account in the blockers, when its currency cannot be resolved from D365', async () => {
    const { service, cashVerifier, dataBatchService } =
      buildService(completeConfig());
    cashVerifier.verify.mockResolvedValueOnce([
      { id: 'PETTY-FIXTURE', status: 'UNKNOWN', currency: null, error: null },
    ]);
    const view = await previewValid(service);
    expect(view.receiptCount).toBe(1);
    expect(view.canSubmit).toBe(true);
    expect(view.blockers.join(' ')).toContain(
      'currency is not resolved from D365',
    );
    expect(view.blockers.join(' ')).toContain(CASH);

    const result = await service.submit(
      view.reviewId,
      submitBody(view.payloadHash),
      OWNER,
    );
    expect(result.batchId).toBe('batch-1');
    const validated = dataBatchService.createAsync.mock.calls[0][5] as Array<{
      ErrorCount: number;
    }>;
    // An unresolved currency is a posting blocker, not a line error, so the batch can still post.
    expect(validated[0].ErrorCount).toBe(0);
  });

  it('reports an empty template as a review with nothing to submit', async () => {
    const { service, store } = buildService(completeConfig());
    const view = await service.preview({
      fileBuffer: await buildMasRevenueTemplate(),
      fileName: 'blank.xlsx',
      companyId: 'mas',
      templateVersion: 1,
      user: OWNER,
    });
    expect(view.uploadValid).toBe(false);
    expect(view.canSubmit).toBe(false);
    expect(view.receiptCount).toBe(0);
    expect(store.lines).toHaveLength(0);
  });

  it('keeps row issues visible and blocks submit for an invalid upload', async () => {
    const { service } = buildService(completeConfig());
    const view = await previewValid(service, [receiptRow('9', { 4: 1800 })]);
    expect(view.uploadValid).toBe(false);
    expect(view.canSubmit).toBe(false);
    const summary = view.summary as {
      issueCount: number;
      issues: Array<{ message: string }>;
    };
    expect(summary.issueCount).toBeGreaterThan(0);
    expect(summary.issues[0].message).toMatch(/total must equal value \+ VAT/);
  });
});

describe('MasRevenueReviewService.submit', () => {
  it('refuses a different user and reveals nothing', async () => {
    const { service } = buildService(completeConfig());
    const view = await previewValid(service);
    await expect(
      service.submit(view.reviewId, submitBody(view.payloadHash), OTHER),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a payload hash that does not match the reviewed snapshot', async () => {
    const { service } = buildService(completeConfig());
    const view = await previewValid(service);
    await expect(
      service.submit(view.reviewId, submitBody('0'.repeat(64)), OWNER),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses a review version that does not exist', async () => {
    const { service } = buildService(completeConfig());
    const view = await previewValid(service);
    await expect(
      service.submit(
        view.reviewId,
        { ...submitBody(view.payloadHash), reviewVersion: 2 },
        OWNER,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('frees the receipts of a deleted batch so the same file can be uploaded again', async () => {
    const { service, dataBatchService, store } = buildService(completeConfig());
    const first = await previewValid(service);
    await service.submit(
      first.reviewId,
      submitBody(first.payloadHash, 'k1'),
      OWNER,
    );

    // Still present: a second upload of the same receipt is a duplicate.
    const blocked = await previewValid(service);
    await expect(
      service.submit(
        blocked.reviewId,
        submitBody(blocked.payloadHash, 'k2'),
        OWNER,
      ),
    ).rejects.toThrow(ConflictException);

    // The batch is deleted: its receipts are freed and the upload goes through.
    dataBatchService.getByIdAsync.mockImplementation(async () => null);
    const again = await previewValid(service);
    const result = await service.submit(
      again.reviewId,
      submitBody(again.payloadHash, 'k3'),
      OWNER,
    );
    expect(result.batchId).toBe('batch-1');
    expect(store.claims).toHaveLength(1);
  });

  it('creates the batch even when configuration gates are open; the gates stop posting, not creation', async () => {
    const config = {
      ...completeConfig(),
      deployedCompatibility: {
        lineServiceVerifiedForGl: true,
        glReadbackVerified: false,
      },
    };
    const { service, dataBatchService } = buildService(config);
    const view = await previewValid(service);

    const result = await service.submit(
      view.reviewId,
      submitBody(view.payloadHash),
      OWNER,
    );
    expect(result.batchId).toBe('batch-1');
    expect(dataBatchService.createAsync).toHaveBeenCalledTimes(1);
  });

  it('creates one Cash In batch for the mas company with stored, exact receipt rows', async () => {
    const { service, dataBatchService } = buildService(completeConfig());
    const view = await previewValid(service);

    const result = await service.submit(
      view.reviewId,
      submitBody(view.payloadHash),
      OWNER,
    );

    expect(result.batchId).toBe('batch-1');
    expect(result.status).toBe('BATCH_CREATED');
    expect(dataBatchService.createAsync).toHaveBeenCalledTimes(1);
    const args = (dataBatchService.createAsync as jest.Mock).mock
      .calls[0] as unknown[];
    expect(args[0]).toBe(EntryProcessorTypes.CashInMasRevenue);
    expect(args[2]).toBe('mas');
    const raw = args[4] as MasRevenueStoredRaw[];
    expect(raw).toHaveLength(1);
    expect(raw[0].InvoiceNumber).toBe('0012');
    expect(raw[0].CustomerName).toBe('شركة اختبار');
    expect(raw[0].TotalMinor).toBe(182400);
  });

  it('returns the same batch for a repeated submit with the same key, without creating another', async () => {
    const { service, dataBatchService } = buildService(completeConfig());
    const view = await previewValid(service);
    const first = await service.submit(
      view.reviewId,
      submitBody(view.payloadHash, 'same'),
      OWNER,
    );
    const second = await service.submit(
      view.reviewId,
      submitBody(view.payloadHash, 'same'),
      OWNER,
    );

    expect(second.batchId).toBe(first.batchId);
    expect(dataBatchService.createAsync).toHaveBeenCalledTimes(1);
  });

  it('refuses a different key once a batch exists for the review', async () => {
    const { service } = buildService(completeConfig());
    const view = await previewValid(service);
    await service.submit(
      view.reviewId,
      submitBody(view.payloadHash, 'first'),
      OWNER,
    );
    await expect(
      service.submit(
        view.reviewId,
        submitBody(view.payloadHash, 'second'),
        OWNER,
      ),
    ).rejects.toThrow(/already created batch/);
  });

  it('creates one batch when the same review is submitted concurrently', async () => {
    const { service, dataBatchService } = buildService(completeConfig());
    const view = await previewValid(service);

    const results = await Promise.allSettled([
      service.submit(view.reviewId, submitBody(view.payloadHash, 'a'), OWNER),
      service.submit(view.reviewId, submitBody(view.payloadHash, 'b'), OWNER),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(dataBatchService.createAsync).toHaveBeenCalledTimes(1);
  });

  it('refuses an invoice that is already in another submitted batch', async () => {
    const { service, dataBatchService } = buildService(completeConfig());
    const first = await previewValid(service, [receiptRow('0012')]);
    await service.submit(
      first.reviewId,
      submitBody(first.payloadHash, 'k1'),
      OWNER,
    );

    const second = await previewValid(service, [receiptRow('0012')]);
    await expect(
      service.submit(
        second.reviewId,
        submitBody(second.payloadHash, 'k2'),
        OWNER,
      ),
    ).rejects.toThrow(
      /already submitted in another batch: invoice 0012 \(batch batch-1\)\. Delete that batch/,
    );
    expect(dataBatchService.createAsync).toHaveBeenCalledTimes(1);
  });

  it('does not expose the posting route from submit (batch only)', async () => {
    const { service } = buildService(completeConfig());
    const view = await previewValid(service);
    const result = await service.submit(
      view.reviewId,
      submitBody(view.payloadHash),
      OWNER,
    );
    expect(result).not.toHaveProperty('postingJobId');
  });
});

describe('MasRevenueReviewService lines', () => {
  it('pages the accepted receipts with the sheet row and the totals as text', async () => {
    const { service } = buildService(completeConfig());
    const view = await previewValid(service);
    const page = await service.getLines(view.reviewId, OWNER, 1, 10);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      sourceRow: 2,
      invoiceNumber: '0012',
      totalMajor: '1824.00',
      cashAccountDisplayName: CASH,
    });
  });
});

describe('MasRevenueReviewService.submit: D365 cash-account checks are applied at posting', () => {
  it('creates the batch whatever the D365 cash-account check says; the checks apply at posting', async () => {
    for (const check of [
      { id: 'PETTY-FIXTURE', status: 'UNKNOWN', currency: null, error: null },
      { id: 'PETTY-FIXTURE', status: 'BANK_ONLY', currency: null, error: null },
      {
        id: 'PETTY-FIXTURE',
        status: 'UNVERIFIABLE',
        currency: null,
        error: 'timeout',
      },
      { id: 'PETTY-FIXTURE', status: 'RCASH', currency: 'USD', error: null },
    ]) {
      const { service, dataBatchService, cashVerifier } =
        buildService(completeConfig());
      cashVerifier.verify.mockResolvedValueOnce([check]);
      const view = await previewValid(service);
      const result = await service.submit(
        view.reviewId,
        submitBody(view.payloadHash),
        OWNER,
      );
      expect(result.batchId).toBe('batch-1');
      expect(dataBatchService.createAsync).toHaveBeenCalledTimes(1);
    }
  });

  it('creates the batch when the cash account is a verified RCash account in the receipt currency', async () => {
    const { service, dataBatchService, cashVerifier } =
      buildService(completeConfig());
    const view = await previewValid(service);

    const result = await service.submit(
      view.reviewId,
      submitBody(view.payloadHash),
      OWNER,
    );

    expect(result.batchId).toBe('batch-1');
    expect(cashVerifier.verify).toHaveBeenCalledWith(['PETTY-FIXTURE']);
    expect(dataBatchService.createAsync).toHaveBeenCalledTimes(1);
  });
});

describe('MasRevenueReviewService.preview: cash-account checks', () => {
  it('runs the read-only cash check during preview; an unknown account is listed as a blocker and the upload stays valid', async () => {
    const { service, cashVerifier } = buildService(completeConfig());
    cashVerifier.verify.mockResolvedValueOnce([
      { id: 'PETTY-FIXTURE', status: 'UNKNOWN', currency: null, error: null },
    ]);
    const view = await previewValid(service);

    expect(cashVerifier.verify).toHaveBeenCalledWith(['PETTY-FIXTURE']);
    expect(view.uploadValid).toBe(true);
    expect(view.canSubmit).toBe(true);
    expect(view.blockers.join(' ')).toMatch(
      /does not exist in CashAccounts for company mas/,
    );
  });

  it('shows a lookup failure as a verification failure, never as an unknown account', async () => {
    const { service, cashVerifier } = buildService(completeConfig());
    cashVerifier.verify.mockResolvedValueOnce([
      {
        id: 'PETTY-FIXTURE',
        status: 'UNVERIFIABLE',
        currency: null,
        error: 'timeout',
      },
    ]);
    const view = await previewValid(service);
    const text = view.blockers.join(' ');

    expect(view.canSubmit).toBe(true);
    expect(text).toMatch(/cash-account verification failed/);
    expect(text).not.toMatch(/does not exist in CashAccounts/);
  });

  it('does not block preview when the account is RCash in the receipt currency', async () => {
    const { service } = buildService(completeConfig());
    const view = await previewValid(service);
    expect(view.blockers.join(' ')).not.toMatch(/cash account/);
    expect(view.canSubmit).toBe(true);
  });
});

/** Creates a batch-holding review as if an earlier submit had created it before identity v2. */
async function seedLegacySubmitted(
  store: FakeStore,
  service: MasRevenueReviewService,
  row: unknown[],
  transactionDate?: string,
) {
  const view = await previewValid(service, [row]);
  store.lines = store.lines.map((line) => {
    if (line.reviewId !== view.reviewId) return line;
    const { IdentityVersion: _version, ...legacyRaw } = line.raw;
    return {
      ...line,
      batchId: 'legacy-batch-1',
      transactionDate: transactionDate ?? line.transactionDate,
      raw: {
        ...legacyRaw,
        TransactionDate: transactionDate ?? legacyRaw.TransactionDate,
      } as MasRevenueStoredRaw,
    };
  });
  const current = store.reviews.get(view.reviewId);
  if (current) {
    store.reviews.set(view.reviewId, {
      ...current,
      status: 'BATCH_CREATED',
      batchId: 'legacy-batch-1',
    });
  }
  return view;
}

function conflictCode(error: unknown): unknown {
  return error instanceof ConflictException
    ? (error.getResponse() as { code?: unknown }).code
    : undefined;
}

describe('MasRevenueReviewService: year-scoped receipt identity', () => {
  it('the same invoice in another year with different content is a distinct receipt with its own PaymentIds', async () => {
    const { service, dataBatchService } = buildService(completeConfig());
    const first = await previewValid(service, [receiptRow('1')]);
    await service.submit(
      first.reviewId,
      submitBody(first.payloadHash, 'k1'),
      OWNER,
    );

    const otherRow = receiptRow('1', { 0: '2027-01-05', 6: 'شركة أخرى' });
    const second = await previewValid(service, [otherRow]);
    await service.submit(
      second.reviewId,
      submitBody(second.payloadHash, 'k2'),
      OWNER,
    );

    expect(dataBatchService.createAsync).toHaveBeenCalledTimes(2);
    const [firstLines, secondLines] =
      dataBatchService.createAsync.mock.calls.map(
        (call) =>
          call[5] as Array<{
            PAYMENTID: string;
            IntegrationIdentity: string;
            Invoice: string;
          }>,
      );
    expect(firstLines[0].PAYMENTID).toMatch(/^MR2026-/);
    expect(secondLines[0].PAYMENTID).toMatch(/^MR2027-/);
    expect(secondLines[0].PAYMENTID).not.toBe(firstLines[0].PAYMENTID);
    expect(secondLines[0].IntegrationIdentity).not.toBe(
      firstLines[0].IntegrationIdentity,
    );
    // The original invoice number is kept unchanged in the document fields.
    expect(secondLines[0].Invoice).toBe('1');
  });

  it('the same invoice re-dated to another year with the same content is refused as a correction', async () => {
    const { service, dataBatchService } = buildService(completeConfig());
    const first = await previewValid(service, [receiptRow('1')]);
    await service.submit(
      first.reviewId,
      submitBody(first.payloadHash, 'k1'),
      OWNER,
    );

    const redated = await previewValid(service, [
      receiptRow('1', { 0: '2027-01-05' }),
    ]);
    const error = await service
      .submit(redated.reviewId, submitBody(redated.payloadHash, 'k2'), OWNER)
      .catch((e: unknown) => e);

    expect(conflictCode(error)).toBe('CORRECTION_REQUIRED');
    expect(dataBatchService.createAsync).toHaveBeenCalledTimes(1);
  });

  it('concurrent submits of the same receipt from two reviews create exactly one batch', async () => {
    const { service, store, dataBatchService } = buildService(completeConfig());
    const a = await previewValid(service, [receiptRow('1')]);
    const b = await previewValid(service, [receiptRow('1')]);

    // Both submits finish their checks before either reserves the identity.
    let arrived = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.beforeClaim = async () => {
      arrived += 1;
      if (arrived === 2) release();
      await gate;
    };

    const results = await Promise.allSettled([
      service.submit(a.reviewId, submitBody(a.payloadHash, 'ka'), OWNER),
      service.submit(b.reviewId, submitBody(b.payloadHash, 'kb'), OWNER),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(conflictCode(rejected[0].reason)).toBe('DUPLICATE_RECEIPT');
    expect(dataBatchService.createAsync).toHaveBeenCalledTimes(1);
    expect(store.claims).toHaveLength(1);
  });

  it('a failed batch creation releases its identity, and the retry reuses the same identity and PaymentIds', async () => {
    const { service, store, dataBatchService } = buildService(completeConfig());
    const view = await previewValid(service, [receiptRow('1')]);
    dataBatchService.createAsync.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await expect(
      service.submit(view.reviewId, submitBody(view.payloadHash, 'k1'), OWNER),
    ).rejects.toThrow(/database unavailable/);
    expect(store.claims).toHaveLength(0);

    await service.submit(
      view.reviewId,
      submitBody(view.payloadHash, 'k2'),
      OWNER,
    );
    expect(store.claims).toHaveLength(1);
    const [firstCall, retryCall] = dataBatchService.createAsync.mock.calls.map(
      (call) =>
        call[5] as Array<{ PAYMENTID: string; IntegrationIdentity: string }>,
    );
    expect(retryCall[0].IntegrationIdentity).toBe(
      firstCall[0].IntegrationIdentity,
    );
    expect(retryCall[0].PAYMENTID).toBe(firstCall[0].PAYMENTID);
  });

  it('the GL PaymentIds of a stored receipt are identical on every rebuild', async () => {
    const { service, store } = buildService(completeConfig());
    const view = await previewValid(service, [receiptRow('1')]);
    const raws = store.lines
      .filter((line) => line.reviewId === view.reviewId)
      .map((line) => line.raw);
    const receipts = raws.map(storedRawToReceipt);
    const first = buildMasRevenueGlLines(completeConfig(), receipts);
    const again = buildMasRevenueGlLines(
      completeConfig(),
      receipts.map((r) => ({ ...r })),
    );
    expect(first.map((line) => line.body.PAYMENTID)).toEqual(
      again.map((line) => line.body.PAYMENTID),
    );
    expect(first[0].body.PAYMENTID).toMatch(/^MR2026-[0-9A-F]{16}-REV$/);
  });

  it('a review created before identity version 2 is refused rather than posted with a legacy id', async () => {
    const { service, store } = buildService(completeConfig());
    const view = await previewValid(service, [receiptRow('1')]);
    store.lines = store.lines.map((line) => {
      const { IdentityVersion: _version, ...legacyRaw } = line.raw;
      return { ...line, raw: legacyRaw as MasRevenueStoredRaw };
    });
    const error = await service
      .submit(view.reviewId, submitBody(view.payloadHash, 'k1'), OWNER)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(String((error as Error).message)).toMatch(
      /created before the receipt identity/,
    );
  });

  describe('legacy submitted records stay protected', () => {
    it('a legacy batch with the same invoice in the same year blocks the new receipt', async () => {
      const { service, store, dataBatchService } =
        buildService(completeConfig());
      await seedLegacySubmitted(store, service, receiptRow('1'));
      const next = await previewValid(service, [receiptRow('1')]);
      const error = await service
        .submit(next.reviewId, submitBody(next.payloadHash, 'k1'), OWNER)
        .catch((e: unknown) => e);
      expect(conflictCode(error)).toBe('DUPLICATE_RECEIPT');
      expect(dataBatchService.createAsync).not.toHaveBeenCalled();
    });

    it('a legacy batch whose date is not reliable requires reconciliation', async () => {
      const { service, store, dataBatchService } =
        buildService(completeConfig());
      await seedLegacySubmitted(store, service, receiptRow('1'), '2026-02-30');
      const next = await previewValid(service, [receiptRow('1')]);
      const error = await service
        .submit(next.reviewId, submitBody(next.payloadHash, 'k1'), OWNER)
        .catch((e: unknown) => e);
      expect(conflictCode(error)).toBe('RECONCILIATION_REQUIRED');
      expect(dataBatchService.createAsync).not.toHaveBeenCalled();
    });

    it('a legacy batch in another year with the same content requires correction', async () => {
      const { service, store, dataBatchService } =
        buildService(completeConfig());
      await seedLegacySubmitted(store, service, receiptRow('1'));
      const next = await previewValid(service, [
        receiptRow('1', { 0: '2027-01-05' }),
      ]);
      const error = await service
        .submit(next.reviewId, submitBody(next.payloadHash, 'k1'), OWNER)
        .catch((e: unknown) => e);
      expect(conflictCode(error)).toBe('CORRECTION_REQUIRED');
      expect(dataBatchService.createAsync).not.toHaveBeenCalled();
    });

    it('a legacy batch in another year with different content does not block a distinct receipt', async () => {
      const { service, store, dataBatchService } =
        buildService(completeConfig());
      await seedLegacySubmitted(store, service, receiptRow('1'));
      const next = await previewValid(service, [
        receiptRow('1', { 0: '2027-01-05', 6: 'شركة أخرى' }),
      ]);
      await service.submit(
        next.reviewId,
        submitBody(next.payloadHash, 'k1'),
        OWNER,
      );
      expect(dataBatchService.createAsync).toHaveBeenCalledTimes(1);
    });
  });
});
