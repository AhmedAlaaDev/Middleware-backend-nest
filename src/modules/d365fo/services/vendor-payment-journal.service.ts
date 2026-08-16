import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { DfoErrorExtractorService } from './dfo-error-extractor.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

import {
  D365FOVendorPaymentJournalHeaderRequest,
  D365FOVendorPaymentJournalHeaderResponse,
  D365FOVendorPaymentJournalLineRequest,
} from '@/modules/d365fo/types';
import { RetryService } from '@/modules/resilience/services/retry.service';

export interface VendorPaymentJournalSettledInvoice {
  JournalLineCompany: string;
  JournalBatchNumber: string;
  JournalLineNumber: number;
  InvoiceNumber: string;
  InvoiceCompany: string;
  InvoiceDueDate: string;
  InvoiceToPaymentCrossRate: number;
  SettlementAmountInInvoiceCurrency: number;
  CashDiscountToTakeInInvoiceCurrency: number;
  invoiceAccount?: string;
  AccountDisplayValue?: string;
}

export interface VendorPaymentJournalHeaderIdentity {
  JournalBatchNumber: string;
  Description?: string;
  IsPosted?: string;
}

export interface VendorOpenInvoiceCandidate {
  Invoice: string;
  AccountNum: string;
  AmountCur: number;
  SettleAmountCur: number;
  CurrencyCode: string;
  DueDate: string;
  Closed: string;
}

/**
 * Service for managing vendor payment journals in D365FO
 * (VendorPaymentJournalHeaders / VendorPaymentJournalLines)
 */
@Injectable()
export class VendorPaymentJournalService {
  private readonly logger = new Logger(VendorPaymentJournalService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
    private readonly retryService: RetryService,
    private readonly dfoErrorExtractor: DfoErrorExtractorService,
  ) {}

  /**
   * Post vendor payment journal header to D365FO (single header)
   */
  public async postHeader(
    data: D365FOVendorPaymentJournalHeaderRequest,
  ): Promise<D365FOVendorPaymentJournalHeaderResponse> {
    this.logger.log(
      `[HEADER] Creating payment header for company: ${data.dataAreaId}`,
    );

    const { JournalBatchNumber: _omit, ...payload } = data;

    return this.d365foClient.post<
      Omit<D365FOVendorPaymentJournalHeaderRequest, 'JournalBatchNumber'>,
      D365FOVendorPaymentJournalHeaderResponse
    >('/data/VendorPaymentJournalHeaders', payload);
  }

  /**
   * Post lines for a specific header (chunked, sequential).
   * Includes idempotency checks to avoid posting duplicate lines.
   */
  public async postLinesForHeader(
    headerKey: string,
    lines: D365FOVendorPaymentJournalLineRequest[],
    chunkSize: number = 20,
    dataAreaId?: string,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const shapedLines = lines.map((line) => ({
      ...line,
      JournalBatchNumber: headerKey,
    }));

    this.logger.log(
      `[LINES] Posting ${shapedLines.length} payment lines for header ${headerKey} in chunks of ${chunkSize}`,
    );

    let existingLines: Set<number> = new Set();
    if (dataAreaId && shapedLines.length > 0) {
      try {
        const existing = await this.listLinesForHeader(headerKey, dataAreaId);
        existingLines = new Set(existing.map((l) => l.LineNumber));
        if (existingLines.size > 0) {
          this.logger.log(
            `[LINES] Found ${existingLines.size} existing lines for header ${headerKey}, will skip duplicates`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `[LINES] Could not query existing lines for header ${headerKey}: ${this.dfoErrorExtractor.extractMessage(error)}`,
        );
      }
    }

    const successfullyPosted: Array<{
      headerId: string;
      lineNumber: number;
    }> = [];

    for (let i = 0; i < shapedLines.length; i += chunkSize) {
      const chunk = shapedLines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.log(
        `[LINES] Processing chunk ${chunkNumber}/${totalChunks} for header ${headerKey} (${chunk.length} lines)`,
      );

      for (const line of chunk) {
        if (existingLines.has(line.LineNumber)) {
          successfullyPosted.push({
            headerId: headerKey,
            lineNumber: line.LineNumber,
          });
          continue;
        }

        try {
          await this.postLine(line);
          successfullyPosted.push({
            headerId: headerKey,
            lineNumber: line.LineNumber,
          });
          if (line !== chunk[chunk.length - 1]) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        } catch (error) {
          const errorDetails = this.dfoErrorExtractor.extractMessage(error);
          this.logger.error(
            `[LINES] Failed to post line ${line.LineNumber} for header ${headerKey}: ${errorDetails}`,
            error instanceof Error ? error.stack : undefined,
          );
          throw new Error(
            `Failed to post line ${line.LineNumber} for header ${headerKey}: ${errorDetails}`,
          );
        }
      }
    }

    return successfullyPosted;
  }

  /**
   * List all lines for a specific header from D365FO
   */
  public async listLinesForHeader(
    headerKey: string,
    dataAreaId: string,
  ): Promise<Array<{ LineNumber: number }>> {
    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', dataAreaId),
      this.queryBuilder.eq('JournalBatchNumber', headerKey),
    );

    const query = this.queryBuilder.buildQuery(
      '/data/VendorPaymentJournalLines',
      {
        filter,
        select: ['LineNumber'],
        crossCompany: true,
      },
    );

    const response = await this.d365foClient.get<{ LineNumber: number }>(
      query,
      { useCache: false },
    );

    return response.value || [];
  }

  public async listIntegrityLinesForHeader(
    headerKey: string,
    dataAreaId: string,
  ): Promise<Array<Record<string, unknown> & { LineNumber: number }>> {
    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', dataAreaId),
      this.queryBuilder.eq('JournalBatchNumber', headerKey),
    );
    const query = this.queryBuilder.buildQuery(
      '/data/VendorPaymentJournalLines',
      {
        filter,
        select: [
          'LineNumber',
          'AccountDisplayValue',
          'AccountType',
          'OffsetAccountDisplayValue',
          'OffsetAccountType',
          'CurrencyCode',
          'DebitAmount',
          'CreditAmount',
          'PaymentId',
          'PaymentReference',
          'MarkedInvoice',
          'TransactionText',
          'FinTagDisplayValue',
          'OffsetFinTagDisplayValue',
          'PostingProfile',
          'TransactionDate',
          'SettleVoucher',
        ],
        top: 10000,
        crossCompany: true,
      },
    );
    const response = await this.d365foClient.get<
      Record<string, unknown> & { LineNumber: number }
    >(query, { useCache: false });
    return response.value ?? [];
  }

  /**
   * Read the actual SpecTrans-backed invoice selections for a vendor payment
   * journal. VendorPaymentJournalLines.MarkedInvoice is not sufficient: the
   * custom X++ service can return success while silently leaving one line
   * unmarked. This child entity is Finance's authoritative settlement state.
   */
  public async listSettledInvoicesForHeader(
    headerKey: string,
    _dataAreaId: string,
  ): Promise<VendorPaymentJournalSettledInvoice[]> {
    // JournalLineCompany is not consistently populated with the data-area ID
    // by this entity. JournalBatchNumber is the reliable Finance key.
    const filter = this.queryBuilder.eq('JournalBatchNumber', headerKey);
    const query = this.queryBuilder.buildQuery(
      '/data/VendorPaymentJournalLineSettledInvoices',
      {
        filter,
        select: [
          'JournalLineCompany',
          'JournalBatchNumber',
          'JournalLineNumber',
          'InvoiceNumber',
          'InvoiceCompany',
          'InvoiceDueDate',
          'InvoiceToPaymentCrossRate',
          'SettlementAmountInInvoiceCurrency',
          'CashDiscountToTakeInInvoiceCurrency',
          'invoiceAccount',
          'AccountDisplayValue',
        ],
        top: 10000,
        crossCompany: true,
      },
    );
    const response =
      await this.d365foClient.get<VendorPaymentJournalSettledInvoice>(query, {
        useCache: false,
      });
    return response.value ?? [];
  }

  /** Locate another unposted journal that currently owns an invoice mark. */
  public async listSettlementOwnersForInvoices(
    dataAreaId: string,
    invoiceNumbers: string[],
  ): Promise<VendorPaymentJournalSettledInvoice[]> {
    const uniqueInvoices = [
      ...new Set(
        invoiceNumbers
          .map((value) => String(value ?? ''))
          .filter((value) => Boolean(value.trim())),
      ),
    ];
    if (uniqueInvoices.length === 0) return [];

    // IIS/D365FO rejects very long OData URLs with HTTP 414. Keep each owner
    // lookup deliberately short even for journals containing hundreds of
    // invoices, while retaining exact and whitespace variants.
    const invoiceChunks: string[][] = [];
    for (let index = 0; index < uniqueInvoices.length; index += 8) {
      invoiceChunks.push(uniqueInvoices.slice(index, index + 8));
    }

    const results: VendorPaymentJournalSettledInvoice[] = [];
    for (let index = 0; index < invoiceChunks.length; index += 4) {
      const requestGroup = invoiceChunks.slice(index, index + 4);
      const responses = await Promise.all(
        requestGroup.map(async (invoiceChunk) => {
          const invoiceValues = [
            ...new Set(
              invoiceChunk.flatMap((value) => {
                const trimmed = value.trim();
                return [
                  value,
                  trimmed,
                  ` ${trimmed}`,
                  `${trimmed} `,
                  ` ${trimmed} `,
                ];
              }),
            ),
          ];
          const invoiceFilter = this.queryBuilder.or(
            ...invoiceValues.map((invoice) =>
              this.queryBuilder.eq('InvoiceNumber', invoice),
            ),
          );
          const filter = this.queryBuilder.and(
            this.queryBuilder.eq('InvoiceCompany', dataAreaId),
            `(${invoiceFilter})`,
          );
          const query = this.queryBuilder.buildQuery(
            '/data/VendorPaymentJournalLineSettledInvoices',
            {
              filter,
              select: [
                'JournalLineCompany',
                'JournalBatchNumber',
                'JournalLineNumber',
                'InvoiceNumber',
                'InvoiceCompany',
                'InvoiceDueDate',
                'InvoiceToPaymentCrossRate',
                'SettlementAmountInInvoiceCurrency',
                'CashDiscountToTakeInInvoiceCurrency',
                'invoiceAccount',
                'AccountDisplayValue',
              ],
              top: 10000,
              crossCompany: true,
            },
          );
          const response =
            await this.d365foClient.get<VendorPaymentJournalSettledInvoice>(
              query,
              { useCache: false },
            );
          return response.value ?? [];
        }),
      );
      responses.forEach((response) => results.push(...response));
    }

    const uniqueResults = new Map<string, VendorPaymentJournalSettledInvoice>();
    for (const result of results) {
      uniqueResults.set(
        `${result.JournalLineCompany}|${result.JournalBatchNumber}|${result.JournalLineNumber}|${result.InvoiceNumber}`,
        result,
      );
    }
    return [...uniqueResults.values()];
  }

  /** Load open vendor-transaction candidates so duplicate invoice IDs can be handled safely. */
  public async listOpenInvoiceCandidatesForInvoices(
    dataAreaId: string,
    invoiceNumbers: string[],
  ): Promise<VendorOpenInvoiceCandidate[]> {
    const uniqueInvoices = [
      ...new Set(
        invoiceNumbers
          .map((value) => String(value ?? ''))
          .filter((value) => Boolean(value.trim())),
      ),
    ];
    const results: VendorOpenInvoiceCandidate[] = [];
    for (let index = 0; index < uniqueInvoices.length; index += 8) {
      const invoiceValues = [
        ...new Set(
          uniqueInvoices.slice(index, index + 8).flatMap((value) => {
            const trimmed = value.trim();
            return [
              value,
              trimmed,
              ` ${trimmed}`,
              `${trimmed} `,
              ` ${trimmed} `,
            ];
          }),
        ),
      ];
      const filter = this.queryBuilder.and(
        this.queryBuilder.eq('dataAreaId', dataAreaId),
        `(${this.queryBuilder.or(
          ...invoiceValues.map((invoice) =>
            this.queryBuilder.eq('Invoice', invoice),
          ),
        )})`,
      );
      const query = this.queryBuilder.buildQuery('/data/VendTransBiEntities', {
        filter,
        select: [
          'Invoice',
          'AccountNum',
          'AmountCur',
          'SettleAmountCur',
          'CurrencyCode',
          'DueDate',
          'Closed',
        ],
        top: 10000,
        crossCompany: true,
      });
      const response = await this.d365foClient.get<VendorOpenInvoiceCandidate>(
        query,
        { useCache: false },
      );
      results.push(...(response.value ?? []));
    }
    return results;
  }

  /** Add only the settlement child record; no payment amount line is reposted. */
  public async addSettledInvoice(
    settlement: VendorPaymentJournalSettledInvoice,
  ): Promise<unknown> {
    return this.d365foClient.post<VendorPaymentJournalSettledInvoice, unknown>(
      '/data/VendorPaymentJournalLineSettledInvoices',
      settlement,
    );
  }

  public async headerExists(
    headerKey: string,
    dataAreaId: string,
  ): Promise<boolean> {
    return (await this.getHeaderIdentity(headerKey, dataAreaId)) !== null;
  }

  public async getHeaderIdentity(
    headerKey: string,
    dataAreaId: string,
  ): Promise<VendorPaymentJournalHeaderIdentity | null> {
    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', dataAreaId),
      this.queryBuilder.eq('JournalBatchNumber', headerKey),
    );
    const query = this.queryBuilder.buildQuery(
      '/data/VendorPaymentJournalHeaders',
      {
        filter,
        select: ['JournalBatchNumber', 'Description', 'IsPosted'],
        top: 1,
        crossCompany: true,
      },
    );
    const response = await this.d365foClient.get<{
      JournalBatchNumber: string;
      Description?: string;
      IsPosted?: string;
    }>(query, { useCache: false });
    return (
      (response.value ?? []).find(
        (header) => header.JournalBatchNumber === headerKey,
      ) ?? null
    );
  }

  public async findHeadersByIntegrationMarker(
    integrationMarker: string,
    dataAreaId: string,
  ): Promise<string[]> {
    const marker = String(integrationMarker ?? '').trim();
    if (!marker) return [];
    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', dataAreaId),
      this.queryBuilder.contains('Description', marker),
    );
    const query = this.queryBuilder.buildQuery(
      '/data/VendorPaymentJournalHeaders',
      {
        filter,
        select: ['JournalBatchNumber', 'Description'],
        top: 100,
        crossCompany: true,
      },
    );
    const response = await this.d365foClient.get<{
      JournalBatchNumber: string;
      Description?: string;
    }>(query, { useCache: false });
    return [
      ...new Set(
        (response.value ?? [])
          .filter((header) => String(header.Description ?? '').includes(marker))
          .map((header) => String(header.JournalBatchNumber ?? '').trim())
          .filter(Boolean),
      ),
    ];
  }

  /**
   * Post a single vendor payment journal line (with retry for concurrency conflicts)
   */
  public async postLine(
    data: D365FOVendorPaymentJournalLineRequest,
  ): Promise<unknown> {
    this.logger.debug(
      `Posting vendor payment journal line for company: ${data.dataAreaId}, batch: ${data.JournalBatchNumber}, line: ${data.LineNumber}`,
    );

    return this.retryService.executeWithRetry(
      async () => {
        const { Voucher: _omitVoucher, ...lineData } = data as any;

        return await this.d365foClient.post<
          Omit<
            D365FOVendorPaymentJournalLineRequest,
            'JournalBatchNumber' | 'Voucher'
          >,
          unknown
        >('/data/VendorPaymentJournalLines', lineData);
      },
      {
        retries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryCondition: (error: unknown) => {
          if (!(error as any)?.response) return true;
          const status = (error as any).response?.status;
          if (status && status >= 500) return true;
          return (
            this.dfoErrorExtractor.normalize(error).isConcurrencyConflict ===
            true
          );
        },
      },
    );
  }

  /**
   * Post multiple vendor payment journal headers in chunks
   */
  public async postHeadersBatch(
    headers: D365FOVendorPaymentJournalHeaderRequest[],
    chunkSize: number = 10,
  ): Promise<string[]> {
    const journalBatchNumbers: string[] = [];

    for (let i = 0; i < headers.length; i += chunkSize) {
      const chunk = headers.slice(i, i + chunkSize);
      const chunkPromises = chunk.map((header) => this.postHeader(header));
      const chunkResults = await Promise.all(chunkPromises);

      for (const result of chunkResults) {
        if (result?.JournalBatchNumber) {
          journalBatchNumbers.push(result.JournalBatchNumber);
        }
      }
    }

    return journalBatchNumbers;
  }

  /**
   * Delete a vendor payment journal header (for rollback)
   */
  public async deleteHeader(
    journalBatchNumber: string,
    dataAreaId: string,
  ): Promise<void> {
    this.logger.debug(
      `[DELETE] Deleting vendor payment journal header ${journalBatchNumber} for company: ${dataAreaId}`,
    );

    const endpoint = `/data/VendorPaymentJournalHeaders(dataAreaId='${dataAreaId}',JournalBatchNumber='${journalBatchNumber}')?cross-company=true`;

    await this.retryService.executeWithRetry(
      async () => {
        await this.d365foClient.delete(endpoint);
      },
      {
        retries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryCondition: (error: unknown) => {
          if (!(error as any)?.response) return true;
          const status = (error as any).response?.status;
          if (status && status >= 500) return true;
          return (
            this.dfoErrorExtractor.normalize(error).isConcurrencyConflict ===
            true
          );
        },
      },
    );
  }

  /**
   * Delete a vendor payment journal line (for rollback)
   */
  public async deleteLine(
    journalBatchNumber: string,
    lineNumber: number,
    dataAreaId: string,
  ): Promise<void> {
    this.logger.debug(
      `[DELETE] Deleting vendor payment journal line ${lineNumber} for journal ${journalBatchNumber} in company: ${dataAreaId}`,
    );

    const endpoint = `/data/VendorPaymentJournalLines(dataAreaId='${dataAreaId}',JournalBatchNumber='${journalBatchNumber}',LineNumber=${lineNumber})?cross-company=true`;

    await this.retryService.executeWithRetry(
      async () => {
        await this.d365foClient.delete(endpoint);
      },
      {
        retries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryCondition: (error: unknown) => {
          if (!(error as any)?.response) return true;
          const status = (error as any).response?.status;
          if (status && status >= 500) return true;
          return (
            this.dfoErrorExtractor.normalize(error).isConcurrencyConflict ===
            true
          );
        },
      },
    );
  }

  /**
   * Temp workaround: patch financial tags on a VendorPaymentJournalLines row
   * after cash-out custom API create (custom endpoint does not persist FinTags).
   */
  public async updateLineFinancialTags(
    journalBatchNumber: string,
    lineNumber: number,
    dataAreaId: string,
    tags: {
      FinTagDisplayValue?: string;
      OffsetFinTagDisplayValue?: string;
    },
  ): Promise<unknown> {
    const finTag = tags.FinTagDisplayValue?.trim() ?? '';
    const offsetFinTag = tags.OffsetFinTagDisplayValue?.trim() ?? '';

    if (!finTag && !offsetFinTag) {
      this.logger.debug(
        `[PATCH] Skipping FinTag update for line ${lineNumber} / ${journalBatchNumber} — both tags empty`,
      );
      return undefined;
    }

    const body: {
      FinTagDisplayValue?: string;
      OffsetFinTagDisplayValue?: string;
    } = {};
    if (finTag) body.FinTagDisplayValue = finTag;
    if (offsetFinTag) body.OffsetFinTagDisplayValue = offsetFinTag;

    this.logger.debug(
      `[PATCH] Updating FinTags on vendor payment line ${lineNumber} for journal ${journalBatchNumber} in company: ${dataAreaId}`,
    );

    const endpoint = `/data/VendorPaymentJournalLines(dataAreaId='${dataAreaId}',JournalBatchNumber='${journalBatchNumber}',LineNumber=${lineNumber})?cross-company=true`;

    return this.retryService.executeWithRetry(
      async () => {
        return await this.d365foClient.patch<typeof body, unknown>(
          endpoint,
          body,
          { headers: { 'If-Match': '*' } },
        );
      },
      {
        retries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryCondition: (error: unknown) => {
          if (!(error as any)?.response) return true;
          const status = (error as any).response?.status;
          if (status && status >= 500) return true;
          return (
            this.dfoErrorExtractor.normalize(error).isConcurrencyConflict ===
            true
          );
        },
      },
    );
  }
}
