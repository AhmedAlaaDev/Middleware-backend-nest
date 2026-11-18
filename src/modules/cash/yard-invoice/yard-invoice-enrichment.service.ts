import { Injectable, Logger } from '@nestjs/common';

import {
  Micro,
  parseDecimalToMicro,
  YardInvoiceDecimalError,
} from './yard-invoice-decimal';
import {
  YardInvoiceLookupResult,
  YardInvoiceMetadata,
} from './yard-invoice-lookup.types';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

/**
 * Read-only, batched resolution of invoice numbers to posted D365 invoices.
 * Every stage is company-scoped (dataAreaId) and reads many keys per request,
 * so a file with thousands of invoices needs hundreds of requests, not
 * thousands. Each key list is an OData `or` group wrapped in parentheses.
 *
 * Stages:
 *   1. FreeTextInvoiceHeaders   FreeTextNumber -> InvoiceIdentifier, IsPosted,
 *                               CustomerAccount, CurrencyCode, DefaultDimensionDisplayValue
 *   2. CustTransBiEntities      Invoice -> Voucher (posted invoice transaction),
 *                               AccountNum, currency, Closed, open balance
 *   3. GeneralJournalEntryBiEntities SubledgerVoucher -> GL entry SourceKey
 *   4. GeneralJournalAccountEntryBiEntities GeneralJournalEntry -> posted
 *                               receivable line (PostingType CustBalance, debit)
 *                               and its FinTag record id
 *   5. FinTageBiEntities        SourceKey = FinTag -> DisplayValue
 *
 * Only the receivable line supplies the invoice financial tag. More than one
 * distinct tag on the receivable lines makes the invoice AMBIGUOUS.
 */
const RECEIVABLE_POSTING_TYPES = new Set(['CustBalance', '31']);
const OPEN_CLOSED_YEAR_CUTOFF = 1901;
const MAX_GL_ENTRIES_PER_VOUCHER = 50;
const CHUNK_SIZE = 40;
const REQUEST_CONCURRENCY = 4;

export interface YardInvoiceEnrichmentOptions {
  chunkSize?: number;
  concurrency?: number;
}

interface HeaderRow {
  InvoiceIdentifier?: string | number;
  FreeTextNumber?: string;
  IsPosted?: string | number | boolean;
  CustomerAccount?: string;
  CurrencyCode?: string;
  DefaultDimensionDisplayValue?: string;
}

interface CustTransRow {
  SourceKey?: string | number;
  Invoice?: string;
  Voucher?: string;
  AccountNum?: string;
  CurrencyCode?: string;
  AmountCur?: string | number;
  SettleAmountCur?: string | number;
  Closed?: string | boolean | null;
}

interface GlEntryRow {
  SourceKey?: string | number;
  SubledgerVoucher?: string;
}

interface GlAccountEntryRow {
  GeneralJournalEntry?: string | number;
  PostingType?: string | number;
  IsCredit?: boolean | string | number;
  FinTag?: string | number;
}

interface FinTagRow {
  SourceKey?: string | number;
  DisplayValue?: string;
}

/** Per-invoice state carried between stages. */
interface Pending {
  invoiceNumber: string;
  header?: HeaderRow;
  trans?: CustTransRow;
  voucher?: string;
  entryKeys?: string[];
  tagId?: string;
  /** Final result, once any stage decides the invoice. */
  result?: YardInvoiceLookupResult;
}

@Injectable()
export class YardInvoiceEnrichmentService {
  private readonly logger = new Logger(YardInvoiceEnrichmentService.name);

  constructor(
    private readonly d365: D365FOClientService,
    private readonly query: ODataQueryBuilderService,
  ) {}

  /**
   * Resolves every distinct invoice number. A failed chunk marks only the
   * invoices in that chunk as LOOKUP_FAILED (retryable), so one bad request
   * does not fail the whole review.
   */
  public async resolveInvoices(
    company: string,
    invoiceNumbers: string[],
    options: YardInvoiceEnrichmentOptions = {},
  ): Promise<Map<string, YardInvoiceLookupResult>> {
    const distinct = [...new Set(invoiceNumbers)];
    const chunkSize = Math.max(
      1,
      Math.min(options.chunkSize ?? CHUNK_SIZE, 100),
    );
    const concurrency = Math.max(
      1,
      Math.min(options.concurrency ?? REQUEST_CONCURRENCY, 8),
    );
    const pending = new Map<string, Pending>(
      distinct.map((invoiceNumber) => [invoiceNumber, { invoiceNumber }]),
    );

    // Stage 1: headers.
    await this.runStage(
      distinct,
      chunkSize,
      concurrency,
      pending,
      async (chunk) => {
        const rows = await this.readAll<HeaderRow>(
          this.buildQuery(
            '/data/FreeTextInvoiceHeaders',
            company,
            'FreeTextNumber',
            chunk,
            [
              'InvoiceIdentifier',
              'FreeTextNumber',
              'IsPosted',
              'CustomerAccount',
              'CurrencyCode',
              'DefaultDimensionDisplayValue',
            ],
          ),
        );
        const byInvoice = groupBy(rows, (r) => String(r.FreeTextNumber ?? ''));
        for (const invoiceNumber of chunk) {
          const state = pending.get(invoiceNumber);
          if (!state) continue;
          const headers = byInvoice.get(invoiceNumber) ?? [];
          if (headers.length === 0) {
            state.result = fail(
              invoiceNumber,
              'NOT_FOUND',
              'no free-text invoice with this number in the company',
            );
          } else if (headers.length > 1) {
            state.result = fail(
              invoiceNumber,
              'AMBIGUOUS',
              'more than one invoice header matches this number',
            );
          } else if (!isYes(headers[0].IsPosted)) {
            state.result = fail(
              invoiceNumber,
              'NOT_POSTED',
              'invoice is not posted',
            );
          } else if (!String(headers[0].CustomerAccount ?? '').trim()) {
            state.result = fail(
              invoiceNumber,
              'MISSING_DIMENSION',
              'invoice has no customer account in D365',
            );
          } else if (
            !String(headers[0].DefaultDimensionDisplayValue ?? '').trim()
          ) {
            state.result = fail(
              invoiceNumber,
              'MISSING_DIMENSION',
              'invoice has no default dimension display value',
            );
          } else {
            state.header = headers[0];
          }
        }
      },
    );

    // Stage 2: posted invoice transaction.
    await this.runStage(
      pendingKeys(pending, (s) => s.header !== undefined),
      chunkSize,
      concurrency,
      pending,
      async (chunk) => {
        const rows = await this.readAll<CustTransRow>(
          this.buildQuery(
            '/data/CustTransBiEntities',
            company,
            'Invoice',
            chunk,
            [
              'SourceKey',
              'Invoice',
              'Voucher',
              'AccountNum',
              'CurrencyCode',
              'AmountCur',
              'SettleAmountCur',
              'Closed',
            ],
          ),
        );
        const invoiceSide = rows.filter((r) => {
          const amount = safeMicro(r.AmountCur);
          return (
            amount !== null &&
            amount > 0n &&
            String(r.Voucher ?? '').trim() !== ''
          );
        });
        const byInvoice = groupBy(invoiceSide, (r) => String(r.Invoice ?? ''));
        for (const invoiceNumber of chunk) {
          const state = pending.get(invoiceNumber);
          if (!state?.header) continue;
          const candidates = byInvoice.get(invoiceNumber) ?? [];
          if (candidates.length === 0) {
            state.result = fail(
              invoiceNumber,
              'NOT_FOUND',
              'no posted invoice transaction with a voucher',
            );
            continue;
          }
          if (candidates.length > 1) {
            state.result = fail(
              invoiceNumber,
              'AMBIGUOUS',
              'more than one posted invoice transaction matches',
            );
            continue;
          }
          const trans = candidates[0];
          const customer = String(state.header.CustomerAccount ?? '').trim();
          if (String(trans.AccountNum ?? '').trim() !== customer) {
            state.result = {
              status: 'CUSTOMER_MISMATCH',
              invoiceNumber,
              message: `posted transaction account ${String(trans.AccountNum ?? '').trim() || '(empty)'} differs from the invoice customer`,
              retryable: false,
            };
            continue;
          }
          const headerCurrency = String(state.header.CurrencyCode ?? '')
            .trim()
            .toUpperCase();
          if (
            String(trans.CurrencyCode ?? '')
              .trim()
              .toUpperCase() !== headerCurrency
          ) {
            state.result = fail(
              invoiceNumber,
              'CUSTOMER_MISMATCH',
              'posted transaction currency differs from the invoice currency',
            );
            continue;
          }
          if (isClosed(trans.Closed)) {
            state.result = fail(
              invoiceNumber,
              'CLOSED',
              'invoice is closed in D365; it is not eligible',
            );
            continue;
          }
          state.trans = trans;
          state.voucher = String(trans.Voucher).trim();
        }
      },
    );

    // A voucher that belongs to two invoices cannot be attributed to either.
    const voucherOwners = groupBy(
      [...pending.values()].filter((s) => s.voucher !== undefined),
      (s) => s.voucher as string,
    );
    for (const owners of voucherOwners.values()) {
      if (owners.length > 1) {
        for (const owner of owners) {
          owner.result = fail(
            owner.invoiceNumber,
            'AMBIGUOUS',
            'the posted voucher is shared by more than one invoice',
          );
          owner.voucher = undefined;
        }
      }
    }

    // Stage 3: GL entries of each voucher.
    await this.runStage(
      pendingKeys(pending, (s) => s.voucher !== undefined),
      chunkSize,
      concurrency,
      pending,
      async (chunk) => {
        const vouchers = [
          ...new Set(chunk.map((i) => pending.get(i)?.voucher as string)),
        ];
        const rows = await this.readAll<GlEntryRow>(
          this.buildQuery(
            '/data/GeneralJournalEntryBiEntities',
            company,
            'SubledgerVoucher',
            vouchers,
            ['SourceKey', 'SubledgerVoucher'],
            {
              extraFilter: `SubledgerVoucherDataAreaId eq '${escapeOData(company)}'`,
              companyFilter: false,
            },
          ),
        );
        const byVoucher = groupBy(rows, (r) =>
          String(r.SubledgerVoucher ?? ''),
        );
        for (const invoiceNumber of chunk) {
          const state = pending.get(invoiceNumber);
          if (!state?.voucher) continue;
          const keys = [
            ...new Set(
              (byVoucher.get(state.voucher) ?? []).map((r) =>
                String(r.SourceKey ?? ''),
              ),
            ),
          ].filter(Boolean);
          if (keys.length === 0) {
            state.result = fail(
              invoiceNumber,
              'NOT_FOUND',
              'no posted general-ledger entry for the invoice voucher',
            );
          } else if (keys.length > MAX_GL_ENTRIES_PER_VOUCHER) {
            state.result = fail(
              invoiceNumber,
              'AMBIGUOUS',
              `voucher has ${keys.length} GL entries; too many to resolve safely`,
            );
          } else {
            state.entryKeys = keys;
          }
        }
      },
    );

    // Stage 4: receivable lines of those entries.
    const entryKeys = [
      ...new Set([...pending.values()].flatMap((s) => s.entryKeys ?? [])),
    ];
    const linesByEntry = new Map<string, GlAccountEntryRow[]>();
    await this.runStage(
      entryKeys,
      chunkSize,
      concurrency,
      undefined,
      async (chunk) => {
        const rows = await this.readAll<GlAccountEntryRow>(
          this.buildQuery(
            '/data/GeneralJournalAccountEntryBiEntities',
            company,
            'GeneralJournalEntry',
            chunk,
            [
              'SourceKey',
              'GeneralJournalEntry',
              'PostingType',
              'IsCredit',
              'FinTag',
            ],
            { numeric: true, companyFilter: false },
          ),
        );
        for (const row of rows) {
          const key = String(row.GeneralJournalEntry ?? '');
          const list = linesByEntry.get(key) ?? [];
          list.push(row);
          linesByEntry.set(key, list);
        }
      },
    );
    for (const state of pending.values()) {
      if (!state.entryKeys || state.result) continue;
      const receivable = state.entryKeys
        .flatMap((key) => linesByEntry.get(key) ?? [])
        .filter(
          (row) =>
            RECEIVABLE_POSTING_TYPES.has(
              String(row.PostingType ?? '').trim(),
            ) && !isYes(row.IsCredit),
        );
      if (receivable.length === 0) {
        state.result = fail(
          state.invoiceNumber,
          'MISSING_TAG',
          'no posted receivable line found for the invoice',
        );
        continue;
      }
      const tagIds = [
        ...new Set(receivable.map((row) => String(row.FinTag ?? '0').trim())),
      ];
      if (tagIds.length > 1) {
        state.result = fail(
          state.invoiceNumber,
          'AMBIGUOUS',
          `receivable lines carry ${tagIds.length} different financial tags; the invoice is ambiguous`,
        );
      } else if (!tagIds[0] || tagIds[0] === '0') {
        state.result = fail(
          state.invoiceNumber,
          'MISSING_TAG',
          'the posted receivable line has no financial tag',
        );
      } else {
        state.tagId = tagIds[0];
      }
    }

    // Stage 5: tag display values, one lookup per distinct tag.
    const tagIds = [
      ...new Set(
        [...pending.values()]
          .map((s) => s.tagId)
          .filter((t): t is string => !!t),
      ),
    ];
    const tagValues = new Map<string, string>();
    await this.runStage(
      tagIds,
      chunkSize,
      concurrency,
      undefined,
      async (chunk) => {
        const rows = await this.readAll<FinTagRow>(
          this.buildQuery(
            '/data/FinTageBiEntities',
            company,
            'SourceKey',
            chunk,
            ['SourceKey', 'DisplayValue'],
            {
              numeric: true,
              companyFilter: false,
            },
          ),
        );
        const byId = groupBy(rows, (r) => String(r.SourceKey ?? ''));
        for (const id of chunk) {
          const matches = byId.get(id) ?? [];
          if (
            matches.length === 1 &&
            String(matches[0].DisplayValue ?? '').trim()
          ) {
            tagValues.set(id, String(matches[0].DisplayValue).trim());
          }
        }
      },
    );

    for (const state of pending.values()) {
      if (state.result) continue;
      if (!state.tagId || !tagValues.has(state.tagId)) {
        state.result = fail(
          state.invoiceNumber,
          'MISSING_TAG',
          'financial tag display value could not be resolved',
        );
        continue;
      }
      const header = state.header as HeaderRow;
      const metadata: YardInvoiceMetadata = {
        invoiceNumber: state.invoiceNumber,
        company,
        invoiceIdentifier: String(header.InvoiceIdentifier ?? ''),
        customerAccount: String(header.CustomerAccount ?? '').trim(),
        currencyCode: String(header.CurrencyCode ?? '')
          .trim()
          .toUpperCase(),
        defaultDimensionDisplayValue: String(
          header.DefaultDimensionDisplayValue ?? '',
        ).trim(),
        financialTagDisplayValue: tagValues.get(state.tagId) as string,
        voucher: state.voucher as string,
        openBalance: computeOpenBalance(state.trans as CustTransRow),
      };
      state.result = { status: 'FOUND', metadata };
    }

    const results = new Map<string, YardInvoiceLookupResult>();
    for (const invoiceNumber of distinct) {
      results.set(
        invoiceNumber,
        pending.get(invoiceNumber)?.result ??
          fail(invoiceNumber, 'NOT_FOUND', 'invoice was not resolved'),
      );
    }

    this.logger.log(
      JSON.stringify({
        event: 'yard_invoice_lookup',
        company,
        invoices: distinct.length,
        found: [...results.values()].filter((r) => r.status === 'FOUND').length,
        lookupFailed: [...results.values()].filter(
          (r) => r.status === 'LOOKUP_FAILED',
        ).length,
      }),
    );
    return results;
  }

  /**
   * Runs one stage over keys in chunks with bounded concurrency. A failed chunk
   * marks its unresolved invoices as LOOKUP_FAILED (retryable) for this review.
   */
  private async runStage(
    keys: string[],
    chunkSize: number,
    concurrency: number,
    pending: Map<string, Pending> | undefined,
    work: (chunk: string[]) => Promise<void>,
  ): Promise<void> {
    const chunks: string[][] = [];
    for (let i = 0; i < keys.length; i += chunkSize)
      chunks.push(keys.slice(i, i + chunkSize));
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const chunk = chunks[next++];
        try {
          await work(chunk);
        } catch (error) {
          this.logger.warn(
            `Yard invoice lookup chunk failed (${chunk.length} keys): ${error instanceof Error ? error.name : 'unknown'}`,
          );
          if (pending) {
            for (const key of chunk) {
              const state = pending.get(key);
              if (state && !state.result) {
                state.result = {
                  status: 'LOOKUP_FAILED',
                  invoiceNumber: key,
                  message: 'D365 read failed; retry the review',
                  retryable: true,
                };
              }
            }
          }
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, chunks.length) }, worker),
    );
  }

  /**
   * `company` filter plus one parenthesised `or` group over `values`. The
   * parentheses make the group bind before `and`.
   */
  private buildQuery(
    endpoint: string,
    company: string,
    field: string,
    values: string[],
    select: string[],
    options: {
      numeric?: boolean;
      extraFilter?: string;
      companyFilter?: boolean;
    } = {},
  ): string {
    const comparisons = values.map((value) =>
      options.numeric
        ? this.query.eq(field, toInt64(value))
        : this.query.eq(field, value),
    );
    const parts = [
      options.companyFilter === false
        ? ''
        : this.query.eq('dataAreaId', company),
      options.extraFilter ?? '',
      `(${comparisons.join(' or ')})`,
    ].filter(Boolean);
    return this.query.buildQuery(endpoint, {
      filter: parts.join(' and '),
      select,
      top: 5000,
      crossCompany: true,
    });
  }

  private async readAll<T>(endpoint: string): Promise<T[]> {
    const response = await this.d365.get<T>(endpoint, { useCache: false });
    if (response['@odata.nextLink']) {
      throw new Error(
        'D365 returned a page continuation; the chunk is too large',
      );
    }
    return response.value ?? [];
  }
}

function pendingKeys(
  pending: Map<string, Pending>,
  include: (state: Pending) => boolean,
): string[] {
  return [...pending.values()]
    .filter((state) => !state.result && include(state))
    .map((state) => state.invoiceNumber);
}

function fail(
  invoiceNumber: string,
  status: Exclude<YardInvoiceLookupResult['status'], 'FOUND' | 'LOOKUP_FAILED'>,
  message: string,
): YardInvoiceLookupResult {
  return { status, invoiceNumber, message, retryable: false };
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
}

function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

/** Int64 keys are sent unquoted; the query builder quotes strings. */
function toInt64(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error('D365 record id is not a safe integer');
  }
  return n;
}

/** Text of a scalar D365 value; anything else is the empty string. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function isYes(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const text = asText(value)
    .trim()
    .toLowerCase();
  return text === 'yes' || text === 'true' || text === '1';
}

/** A Closed value is a real date (not the 1900 sentinel) when closed. */
function isClosed(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text = asText(value).trim();
  if (!text) return false;
  const year = Number(text.slice(0, 4));
  return Number.isFinite(year) && year >= OPEN_CLOSED_YEAR_CUTOFF;
}

function safeMicro(value: unknown): Micro | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    if (typeof value === 'number') {
      return parseDecimalToMicro(
        /e/i.test(String(value)) ? value.toFixed(6) : String(value),
      );
    }
    return parseDecimalToMicro(typeof value === 'string' ? value : '');
  } catch (error) {
    if (error instanceof YardInvoiceDecimalError) return null;
    throw error;
  }
}

/** AmountCur less settled amount, as the existing settlement service does. */
function computeOpenBalance(row: CustTransRow): Micro | null {
  const amount = safeMicro(row.AmountCur);
  if (amount === null) return null;
  const settled = safeMicro(row.SettleAmountCur) ?? 0n;
  const absSettled = settled < 0n ? -settled : settled;
  return amount - absSettled;
}
