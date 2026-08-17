import { Injectable, Logger } from '@nestjs/common';
import { isAxiosError } from 'axios';

import { D365FOClientService } from './d365fo-client.service';
import { DfoErrorExtractorService } from './dfo-error-extractor.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

import {
  D365FOVendorInvoiceJournalHeaderRequest,
  D365FOVendorInvoiceJournalHeaderResponse,
  D365FOVendorInvoiceJournalLineRequest,
} from '@/modules/d365fo/types';
import { RetryService } from '@/modules/resilience/services/retry.service';

/** Max invoices per OR filter chunk (FO does not support OData `in`). */
const VENDOR_INVOICE_LOOKUP_CHUNK_SIZE = 20;
/** Onebox throttles parallel VendInvoiceJournalLines lookups quickly. */
const VENDOR_INVOICE_LOOKUP_CONCURRENCY = 1;
/** Extra chunk-level attempts after axios retries for FO throttle/overload. */
const VENDOR_INVOICE_LOOKUP_CHUNK_RETRIES = 5;

export type VendorInvoiceVendorPairKey = string;

export type VendorInvoiceLookupPair = {
  invoice: string;
  vendorAccount: string;
};

export type VendorInvoiceLookupOptions = {
  chunkSize?: number;
  concurrency?: number;
  vendorAccounts?: string[];
  pairs?: VendorInvoiceLookupPair[];
};

/**
 * Service for managing vendor invoice journals in D365FO
 */
@Injectable()
export class VendorInvoiceJournalService {
  private readonly logger = new Logger(VendorInvoiceJournalService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
    private readonly retryService: RetryService,
    private readonly dfoErrorExtractor: DfoErrorExtractorService,
  ) {}

  /**
   * Build map key for invoice + vendor account pair (case-insensitive).
   * D365/Excel values can contain non-printing direction marks.
   */
  public static pairKey(invoice: string, vendorAccount: string): string {
    return `${this.normalizeLookupValue(invoice)}|${this.normalizeLookupValue(vendorAccount)}`;
  }

  private static cleanLookupValue(value?: string): string {
    return this.preserveLookupValue(value).trim();
  }

  private static preserveLookupValue(value?: string): string {
    return String(value ?? '')
      .replace(
        /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g,
        '',
      )
      .replace(/\u00a0/g, ' ')
      .normalize('NFKC');
  }

  private static normalizeLookupValue(value?: string): string {
    return this.cleanLookupValue(value).toLowerCase();
  }

  /**
   * Batch-lookup existing invoice/vendor pairs on posted vendor invoices.
   * Look up from vendor account to invoice (never invoice-only): short invoice
   * numbers like "386" collide across vendors and truncate the FO page.
   */
  public async findExistingInvoiceVendorPairs(
    company: string,
    invoices: string[],
    options?: VendorInvoiceLookupOptions,
  ): Promise<Set<VendorInvoiceVendorPairKey>> {
    const invoiceIds = await this.findExistingInvoiceVendorPairInvoiceIds(
      company,
      invoices,
      options,
    );

    return new Set(invoiceIds.keys());
  }

  /**
   * Resolve each normalized invoice/vendor pair to the exact InvoiceId stored
   * in D365. Surrounding spaces matter to the settlement custom service even
   * though validation deliberately matches the normalized pair.
   */
  public async findExistingInvoiceVendorPairInvoiceIds(
    company: string,
    invoices: string[],
    options?: VendorInvoiceLookupOptions,
  ): Promise<Map<VendorInvoiceVendorPairKey, string>> {
    const uniqueInvoices = [
      ...new Set(
        invoices
          .map((invoice) =>
            VendorInvoiceJournalService.preserveLookupValue(invoice),
          )
          .filter((invoice) => Boolean(invoice.trim())),
      ),
    ];

    const vendorAccounts = [
      ...new Set(
        (options?.vendorAccounts ?? [])
          .concat((options?.pairs ?? []).map((p) => p.vendorAccount))
          .map((v) => VendorInvoiceJournalService.cleanLookupValue(v))
          .filter(Boolean),
      ),
    ];

    const existingInvoiceIds = new Map<VendorInvoiceVendorPairKey, string>();

    if (uniqueInvoices.length === 0 && vendorAccounts.length === 0) {
      return existingInvoiceIds;
    }

    const chunkSize = Math.min(
      40,
      Math.max(1, options?.chunkSize ?? VENDOR_INVOICE_LOOKUP_CHUNK_SIZE),
    );
    const concurrency = Math.min(
      5,
      Math.max(1, options?.concurrency ?? VENDOR_INVOICE_LOOKUP_CONCURRENCY),
    );

    // Prioritize querying by vendor account first (so invoice casing/formatting variations
    // in source data match D365 posted records reliably).
    const useVendorLookup = vendorAccounts.length > 0;
    const chunks = useVendorLookup
      ? this.chunkArray(vendorAccounts, Math.min(10, chunkSize))
      : this.chunkArray(uniqueInvoices, chunkSize);
    const totalLookups = chunks.length;

    this.logger.log(
      useVendorLookup
        ? `[LOOKUP] Resolving vendor invoices for ${vendorAccounts.length} vendor(s) in company '${company}' in ${totalLookups} lookup(s) (chunkSize=${chunkSize}, concurrency=${concurrency})`
        : `[LOOKUP] Resolving ${uniqueInvoices.length} vendor invoices against posted D365 vendor invoices for company '${company}' in ${totalLookups} lookup(s) (chunkSize=${chunkSize}, concurrency=${concurrency})`,
    );

    const startMs = Date.now();

    for (let i = 0; i < chunks.length; i += concurrency) {
      const wave = chunks.slice(i, i + concurrency);
      const waveResults = await Promise.all(
        wave.map((chunk, j) =>
          useVendorLookup
            ? this.fetchInvoiceVendorPairsByVendorsChunk(
                company,
                chunk as string[],
                i + j + 1,
                totalLookups,
              )
            : this.fetchInvoiceVendorPairsByInvoicesChunk(
                company,
                chunk as string[],
                i + j + 1,
                totalLookups,
              ),
        ),
      );

      for (const invoiceIds of waveResults) {
        for (const [key, invoiceId] of invoiceIds) {
          if (!existingInvoiceIds.has(key)) {
            existingInvoiceIds.set(key, invoiceId);
          }
        }
      }
    }

    this.logger.log(
      `[LOOKUP] Found ${existingInvoiceIds.size} invoice/vendor pair(s) for ${uniqueInvoices.length} invoice(s) / ${vendorAccounts.length} vendor(s) in ${Date.now() - startMs}ms`,
    );

    return existingInvoiceIds;
  }

  private async fetchInvoiceVendorPairsByVendorsChunk(
    company: string,
    vendors: string[],
    chunkIndex: number,
    totalChunks: number,
  ): Promise<Map<VendorInvoiceVendorPairKey, string>> {
    const vendorFilters = vendors.map((vendor) => {
      return `(${this.queryBuilder.or(
        ...this.lookupValueVariants(vendor).flatMap((v) => [
          this.queryBuilder.eq('InvoiceAccount', v),
          this.queryBuilder.eq('OrderAccount', v),
        ]),
      )})`;
    });
    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', company),
      vendorFilters.length > 0 ? `(${vendorFilters.join(' or ')})` : '',
    );

    const endpoint = this.queryBuilder.buildQuery(
      '/data/VendInvoiceJourBiEntities',
      {
        filter,
        select: ['InvoiceId', 'InvoiceAccount', 'OrderAccount'],
        crossCompany: true,
      },
    );

    type RawLine = {
      InvoiceId?: string;
      InvoiceAccount?: string;
      OrderAccount?: string;
    };

    try {
      return await this.retryService.executeWithRetry(
        async () => {
          let pageEndpoint = endpoint;
          let pages = 0;
          const pageInvoiceIds = new Map<VendorInvoiceVendorPairKey, string>();

          while (true) {
            pages += 1;
            const response = await this.d365foClient.get<RawLine>(
              pageEndpoint,
              {
                useCache: false,
              },
            );

            for (const row of response.value ?? []) {
              const invoice = row.InvoiceId;
              const invoiceAccount = row.InvoiceAccount;
              const orderAccount = row.OrderAccount;
              if (!invoice?.trim()) continue;

              if (invoiceAccount?.trim()) {
                pageInvoiceIds.set(
                  VendorInvoiceJournalService.pairKey(invoice, invoiceAccount),
                  invoice,
                );
              }
              if (orderAccount?.trim()) {
                pageInvoiceIds.set(
                  VendorInvoiceJournalService.pairKey(invoice, orderAccount),
                  invoice,
                );
              }
            }

            const nextLink = response['@odata.nextLink'];
            if (!nextLink) break;
            pageEndpoint = this.getEndpointFromNextLink(nextLink);
          }

          // 2. Also query VendTransBiEntities to cover direct vendor ledger entries
          try {
            const vendTransFilters = vendors.map((vendor) => {
              return `(${this.queryBuilder.or(
                ...this.lookupValueVariants(vendor).map((v) =>
                  this.queryBuilder.eq('AccountNum', v),
                ),
              )})`;
            });
            const transFilter = this.queryBuilder.and(
              this.queryBuilder.eq('dataAreaId', company),
              vendTransFilters.length > 0
                ? `(${vendTransFilters.join(' or ')})`
                : '',
            );
            const transEndpoint = this.queryBuilder.buildQuery(
              '/data/VendTransBiEntities',
              {
                filter: transFilter,
                select: ['Invoice', 'AccountNum'],
                crossCompany: true,
              },
            );
            let transPageEndpoint = transEndpoint;
            while (true) {
              const transResponse = await this.d365foClient.get<{
                Invoice?: string;
                AccountNum?: string;
              }>(transPageEndpoint, { useCache: false });
              for (const row of transResponse.value ?? []) {
                const invoice = row.Invoice;
                const accountNum = row.AccountNum;
                if (!invoice?.trim() || !accountNum?.trim()) continue;
                pageInvoiceIds.set(
                  VendorInvoiceJournalService.pairKey(invoice, accountNum),
                  invoice,
                );
              }
              const nextLink = transResponse['@odata.nextLink'];
              if (!nextLink) break;
              transPageEndpoint = this.getEndpointFromNextLink(nextLink);
            }
          } catch (transError) {
            this.logger.debug(
              `[LOOKUP] VendTransBiEntities fallback query for vendors skipped: ${this.dfoErrorExtractor.extractMessage(transError)}`,
            );
          }

          this.logger.debug(
            `[LOOKUP] Chunk ${chunkIndex}/${totalChunks}: ${vendors.length} vendor(s) → ${pageInvoiceIds.size} pair(s) in ${pages} page(s)`,
          );

          return pageInvoiceIds;
        },
        {
          retries: VENDOR_INVOICE_LOOKUP_CHUNK_RETRIES,
          retryDelay: 2 * 60 * 1000,
          exponentialBackoff: false,
          retryCondition: (error: unknown) => {
            const status = (error as { response?: { status?: number } })
              ?.response?.status;
            if (status === 429 || (status !== undefined && status >= 500)) {
              return true;
            }
            return this.retryService.isFoThrottleError(error);
          },
        },
      );
    } catch (error) {
      const errorDetails = this.dfoErrorExtractor.extractMessage(error);
      this.logger.error(
        `[LOOKUP] Chunk ${chunkIndex}/${totalChunks} failed: ${errorDetails}`,
      );
      throw new Error(
        `Vendor invoice lookup failed (chunk ${chunkIndex}/${totalChunks}): ${errorDetails}`,
      );
    }
  }

  private async fetchInvoiceVendorPairsByInvoicesChunk(
    company: string,
    invoices: string[],
    chunkIndex: number,
    totalChunks: number,
  ): Promise<Map<VendorInvoiceVendorPairKey, string>> {
    const invoiceOrFilter =
      invoices.length > 0
        ? `(${this.queryBuilder.or(
            ...invoices.flatMap((invoice) =>
              this.lookupValueVariants(invoice).map((value) =>
                this.queryBuilder.eq('InvoiceId', value),
              ),
            ),
          )})`
        : '';
    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', company),
      invoiceOrFilter,
    );

    const endpoint = this.queryBuilder.buildQuery(
      '/data/VendInvoiceJourBiEntities',
      {
        filter,
        select: ['InvoiceId', 'InvoiceAccount', 'OrderAccount'],
        crossCompany: true,
      },
    );

    type RawLine = {
      InvoiceId?: string;
      InvoiceAccount?: string;
      OrderAccount?: string;
    };

    try {
      return await this.retryService.executeWithRetry(
        async () => {
          let pageEndpoint = endpoint;
          let pages = 0;
          const pageInvoiceIds = new Map<VendorInvoiceVendorPairKey, string>();

          while (true) {
            pages += 1;
            const response = await this.d365foClient.get<RawLine>(
              pageEndpoint,
              {
                useCache: false,
              },
            );

            for (const row of response.value ?? []) {
              const invoice = row.InvoiceId;
              const invoiceAccount = row.InvoiceAccount;
              const orderAccount = row.OrderAccount;
              if (!invoice?.trim()) continue;

              if (invoiceAccount?.trim()) {
                pageInvoiceIds.set(
                  VendorInvoiceJournalService.pairKey(invoice, invoiceAccount),
                  invoice,
                );
              }
              if (orderAccount?.trim()) {
                pageInvoiceIds.set(
                  VendorInvoiceJournalService.pairKey(invoice, orderAccount),
                  invoice,
                );
              }
            }

            const nextLink = response['@odata.nextLink'];
            if (!nextLink) break;
            pageEndpoint = this.getEndpointFromNextLink(nextLink);
          }

          this.logger.debug(
            `[LOOKUP] Chunk ${chunkIndex}/${totalChunks}: ${invoices.length} invoice(s) → ${pageInvoiceIds.size} pair(s) in ${pages} page(s)`,
          );

          return pageInvoiceIds;
        },
        {
          retries: VENDOR_INVOICE_LOOKUP_CHUNK_RETRIES,
          retryDelay: 2 * 60 * 1000,
          exponentialBackoff: false,
          retryCondition: (error: unknown) => {
            const status = (error as { response?: { status?: number } })
              ?.response?.status;
            if (status === 429 || (status !== undefined && status >= 500)) {
              return true;
            }
            return this.retryService.isFoThrottleError(error);
          },
        },
      );
    } catch (error) {
      const errorDetails = this.dfoErrorExtractor.extractMessage(error);
      this.logger.error(
        `[LOOKUP] Chunk ${chunkIndex}/${totalChunks} failed: ${errorDetails}`,
      );
      throw new Error(
        `Vendor invoice lookup failed (chunk ${chunkIndex}/${totalChunks}): ${errorDetails}`,
      );
    }
  }

  private lookupValueVariants(value: string): string[] {
    const normalized = VendorInvoiceJournalService.cleanLookupValue(value);
    return [
      ...new Set([
        value,
        normalized,
        ` ${normalized}`,
        `${normalized} `,
        ` ${normalized} `,
      ]),
    ];
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }

  private getEndpointFromNextLink(nextLink: string): string {
    try {
      const url = new URL(nextLink);
      return `${url.pathname}${url.search}`;
    } catch {
      return nextLink;
    }
  }

  /**
   * Post vendor invoice journal header to D365FO (single header)
   * @param data Header request
   * @returns Created header response with JournalBatchNumber
   */
  public async postHeader(
    data: D365FOVendorInvoiceJournalHeaderRequest,
  ): Promise<D365FOVendorInvoiceJournalHeaderResponse> {
    this.logger.log(`[HEADER] Creating header for company: ${data.dataAreaId}`);

    const { JournalBatchNumber: _omit, ...payload } = data;

    return this.d365foClient.post<
      Omit<D365FOVendorInvoiceJournalHeaderRequest, 'JournalBatchNumber'>,
      D365FOVendorInvoiceJournalHeaderResponse
    >('/data/VendInvoiceJournalHeaders', payload);
  }

  /**
   * Post lines for a specific header (chunked, sequential, no parallel)
   * Includes idempotency checks to avoid posting duplicate lines
   * @param headerKey JournalBatchNumber of the header
   * @param lines Array of line requests for this header
   * @param chunkSize Number of lines to post per chunk (default: 20)
   * @param dataAreaId Company data area ID (required for idempotency checks)
   * @returns Array of successfully posted line identifiers
   */
  public async postLinesForHeader(
    headerKey: string,
    lines: D365FOVendorInvoiceJournalLineRequest[],
    chunkSize: number = 20,
    dataAreaId?: string,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    // Line attachment / request shaping: set JournalBatchNumber, strip FullPrimaryRemittanceAddress (D365FO services only)
    const shapedLines = lines.map((line) => {
      const { FullPrimaryRemittanceAddress, ...rest } = line as any;
      return {
        ...rest,
        JournalBatchNumber: headerKey,
      } as D365FOVendorInvoiceJournalLineRequest;
    });

    this.logger.log(
      `[LINES] Posting ${shapedLines.length} lines for header ${headerKey} in chunks of ${chunkSize}`,
    );

    // Check for existing lines to avoid duplicate posting (idempotency)
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
        // If query fails, log warning but continue (might be first time posting)
        this.logger.warn(
          `[LINES] Could not query existing lines for header ${headerKey}, proceeding without idempotency check: ${this.dfoErrorExtractor.extractMessage(error)}`,
        );
      }
    }

    const successfullyPosted: Array<{
      headerId: string;
      lineNumber: number;
    }> = [];

    // Process in chunks sequentially (no parallel within chunk)
    for (let i = 0; i < shapedLines.length; i += chunkSize) {
      const chunk = shapedLines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.log(
        `[LINES] Processing chunk ${chunkNumber}/${totalChunks} for header ${headerKey} (${chunk.length} lines)`,
      );

      // Post lines sequentially within chunk (no parallel)
      // Add small delay between line posts to allow D365FO internal processes to complete
      for (const line of chunk) {
        // Skip if line already exists (idempotency check)
        if (existingLines.has(line.LineNumber)) {
          this.logger.debug(
            `[LINES] Skipping line ${line.LineNumber} for header ${headerKey} - already exists`,
          );
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
          this.logger.debug(
            `[LINES] Posted line ${line.LineNumber} for header ${headerKey}`,
          );

          // Add delay between line posts to allow D365FO internal processes (validation, workflow) to complete
          // This reduces the chance of RecVersion conflicts
          if (line !== chunk[chunk.length - 1]) {
            // Don't delay after the last line in chunk
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        } catch (error) {
          const errorDetails = this.dfoErrorExtractor.extractMessage(error);
          this.logger.error(
            `[LINES] Failed to post line ${line.LineNumber} for header ${headerKey} in chunk ${chunkNumber}: ${errorDetails}`,
            error instanceof Error ? error.stack : undefined,
          );
          throw new Error(
            `Failed to post line ${line.LineNumber} for header ${headerKey}: ${errorDetails}`,
          );
        }
      }

      this.logger.log(
        `[LINES] Completed chunk ${chunkNumber}/${totalChunks} for header ${headerKey} (${chunk.length} lines posted)`,
      );
    }

    this.logger.log(
      `[LINES] Successfully posted all ${shapedLines.length} lines for header ${headerKey}`,
    );

    return successfullyPosted;
  }

  /**
   * Query and list all lines for a specific header from D365FO
   * @param headerKey JournalBatchNumber of the header
   * @param dataAreaId Company data area ID
   * @returns Array of line objects with LineNumber
   */
  public async listLinesForHeader(
    headerKey: string,
    dataAreaId: string,
  ): Promise<Array<{ LineNumber: number }>> {
    this.logger.debug(
      `[QUERY] Querying lines for header ${headerKey} in company ${dataAreaId}`,
    );

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', dataAreaId),
      this.queryBuilder.eq('JournalBatchNumber', headerKey),
    );

    const query = this.queryBuilder.buildQuery(
      '/data/VendInvoiceJournalLines',
      {
        filter,
        select: ['LineNumber'],
        crossCompany: true,
      },
    );

    try {
      const response = await this.d365foClient.get<{ LineNumber: number }>(
        query,
        {
          useCache: false,
        },
      );

      const lines = response.value || [];
      this.logger.debug(
        `[QUERY] Found ${lines.length} lines for header ${headerKey}`,
      );

      return lines;
    } catch (error) {
      const errorDetails = this.dfoErrorExtractor.extractMessage(error);
      this.logger.error(
        `[QUERY] Failed to query lines for header ${headerKey}: ${errorDetails}`,
      );
      throw error;
    }
  }

  /**
   * Post vendor invoice journal line to D365FO
   * Includes retry logic with exponential backoff for concurrency conflicts
   */
  public async postLine(
    data: D365FOVendorInvoiceJournalLineRequest,
  ): Promise<any> {
    this.logger.debug(
      `Posting vendor invoice journal line for company: ${data.dataAreaId}, batch: ${data.JournalBatchNumber}, line: ${data.LineNumber}`,
    );

    // Remove FullPrimaryRemittanceAddress from line body before posting
    const {
      FullPrimaryRemittanceAddress,
      Voucher: _omitVoucher,
      ...lineData
    } = data as any;

    // Use retry service with custom condition for concurrency conflicts
    return this.retryService.executeWithRetry(
      async () => {
        return await this.d365foClient.post<any, any>(
          '/data/VendInvoiceJournalLines',
          lineData,
        );
      },
      {
        retries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryCondition: (error: any) => {
          if (!error.response) return true;
          const status = error.response?.status;
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
   * Post multiple vendor invoice journal headers in chunks
   * @param headers Array of header requests
   * @param chunkSize Number of headers to post per chunk (default: 10)
   * @returns Array of JournalBatchNumbers (as strings)
   */
  public async postHeadersBatch(
    headers: D365FOVendorInvoiceJournalHeaderRequest[],
    chunkSize: number = 10,
  ): Promise<string[]> {
    this.logger.debug(
      `Posting ${headers.length} headers in chunks of ${chunkSize}`,
    );

    const journalBatchNumbers: string[] = [];

    // Process in chunks
    for (let i = 0; i < headers.length; i += chunkSize) {
      const chunk = headers.slice(i, i + chunkSize);
      this.logger.debug(
        `Posting chunk ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(headers.length / chunkSize)} (${chunk.length} headers)`,
      );

      // Post headers in parallel within chunk
      const chunkPromises = chunk.map((header) => this.postHeader(header));
      const chunkResults = await Promise.all(chunkPromises);

      // Extract JournalBatchNumbers from responses
      for (const result of chunkResults) {
        const journalBatchNumber = result?.JournalBatchNumber;
        if (journalBatchNumber) {
          journalBatchNumbers.push(journalBatchNumber);
        } else {
          this.logger.warn(
            'Header posted but JournalBatchNumber not found in response',
            JSON.stringify(result),
          );
        }
      }
    }

    this.logger.debug(
      `Successfully posted ${journalBatchNumbers.length} headers`,
    );
    return journalBatchNumbers;
  }

  /**
   * Post multiple vendor invoice journal lines in chunks
   * @param lines Array of line requests
   * @param chunkSize Number of lines to post per chunk (default: 20)
   * @returns Array of successfully posted line identifiers
   * @throws Error if any line fails - caller should rollback headers and successfully posted lines
   */
  public async postLinesBatch(
    lines: D365FOVendorInvoiceJournalLineRequest[],
    chunkSize: number = 20,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    this.logger.debug(
      `Posting ${lines.length} lines in chunks of ${chunkSize}`,
    );

    const successfullyPosted: Array<{
      headerId: string;
      lineNumber: number;
    }> = [];

    // Process in chunks
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.debug(
        `Posting chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
      );

      try {
        // Post lines in parallel within chunk, tracking successes
        const chunkPromises = chunk.map(async (line) => {
          await this.postLine(line);
          return {
            headerId: line.JournalBatchNumber,
            lineNumber: line.LineNumber,
          };
        });

        const chunkResults = await Promise.all(chunkPromises);
        successfullyPosted.push(...chunkResults);

        this.logger.debug(
          `Successfully posted chunk ${chunkNumber} (${chunk.length} lines)`,
        );
      } catch (error: unknown) {
        const errorDetails = this.dfoErrorExtractor.extractMessage(error);

        if (isAxiosError(error) && error.response?.data) {
          this.logger.error(
            `D365FO error response: ${JSON.stringify(error.response.data)}`,
          );
        }

        this.logger.error(
          `Failed to post chunk ${chunkNumber} of ${totalChunks}: ${errorDetails}`,
          error instanceof Error ? error.stack : undefined,
        );

        let errorMessage = `Failed to post lines in chunk ${chunkNumber}: ${errorDetails}`;

        if (successfullyPosted.length > 0) {
          errorMessage += `. ${successfullyPosted.length} lines were posted successfully before failure. Rollback required.`;
          this.logger.warn(
            `Successfully posted ${successfullyPosted.length} lines before failure. Rollback required.`,
          );
        } else {
          errorMessage += `. No lines were posted successfully.`;
          this.logger.warn(
            `No lines were posted successfully in chunk ${chunkNumber}. Only headers need rollback.`,
          );
        }

        // Re-throw to trigger rollback in processor
        throw new Error(errorMessage);
      }
    }

    this.logger.debug(
      `Successfully posted all ${lines.length} lines (${successfullyPosted.length} tracked)`,
    );

    return successfullyPosted;
  }

  /**
   * Delete a vendor invoice journal header (for rollback)
   * Includes retry logic for concurrency conflicts
   * @param journalBatchNumber The JournalBatchNumber of the header to delete
   * @param dataAreaId The company data area ID
   */
  public async deleteHeader(
    journalBatchNumber: string,
    dataAreaId: string,
  ): Promise<void> {
    this.logger.debug(
      `[DELETE] Deleting vendor invoice journal header ${journalBatchNumber} for company: ${dataAreaId}`,
    );

    // D365FO uses JournalBatchNumber for deletion
    // Format: /data/VendInvoiceJournalHeaders(dataAreaId='m-p',JournalBatchNumber='Mesco-000001956')
    const endpoint = `/data/VendInvoiceJournalHeaders(dataAreaId='${dataAreaId}',JournalBatchNumber='${journalBatchNumber}')?cross-company=true`;

    // Use retry service with custom condition for concurrency conflicts
    await this.retryService.executeWithRetry(
      async () => {
        const response = await this.d365foClient.delete(endpoint);
        // Verify deletion response (should be empty or 204)
        if (response !== undefined && response !== null) {
          this.logger.debug(
            `[DELETE] Header ${journalBatchNumber} deleted successfully`,
          );
        }
      },
      {
        retries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryCondition: (error: any) => {
          if (!error.response) return true;
          const status = error.response?.status;
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
   * Delete a vendor invoice journal line (for rollback)
   * Includes retry logic for concurrency conflicts
   * @param journalBatchNumber The JournalBatchNumber of the line to delete
   * @param lineNumber The LineNumber of the line to delete
   * @param dataAreaId The company data area ID
   */
  public async deleteLine(
    journalBatchNumber: string,
    lineNumber: number,
    dataAreaId: string,
  ): Promise<void> {
    this.logger.debug(
      `[DELETE] Deleting vendor invoice journal line ${lineNumber} for journal ${journalBatchNumber} in company: ${dataAreaId}`,
    );

    // Format: /data/VendInvoiceJournalLines(dataAreaId='m-p',JournalBatchNumber='Mesco-000010002',LineNumber=1)?cross-company=true
    const endpoint = `/data/VendInvoiceJournalLines(dataAreaId='${dataAreaId}',JournalBatchNumber='${journalBatchNumber}',LineNumber=${lineNumber})?cross-company=true`;

    // Use retry service with custom condition for concurrency conflicts
    await this.retryService.executeWithRetry(
      async () => {
        const response = await this.d365foClient.delete(endpoint);
        // Verify deletion response (should be empty or 204)
        if (response !== undefined && response !== null) {
          this.logger.debug(
            `[DELETE] Line ${lineNumber} for journal ${journalBatchNumber} deleted successfully`,
          );
        }
      },
      {
        retries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        retryCondition: (error: any) => {
          if (!error.response) return true;
          const status = error.response?.status;
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
   * Delete multiple vendor invoice journal lines in chunks
   * @param lines Array of line identifiers to delete
   * @param dataAreaId The company data area ID
   * @param chunkSize Number of lines to delete per chunk (default: 20)
   * @returns Array of results indicating success/failure for each line
   */
  public async deleteLinesBatch(
    lines: Array<{ journalBatchNumber: string; lineNumber: number }>,
    dataAreaId: string,
    chunkSize: number = 20,
  ): Promise<
    Array<{
      journalBatchNumber: string;
      lineNumber: number;
      success: boolean;
      error?: string;
    }>
  > {
    this.logger.debug(
      `Deleting ${lines.length} lines in chunks of ${chunkSize}`,
    );

    const results: Array<{
      journalBatchNumber: string;
      lineNumber: number;
      success: boolean;
      error?: string;
    }> = [];

    // Process in chunks
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.debug(
        `Deleting chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
      );

      // Delete lines in parallel within chunk
      const deletePromises = chunk.map(async (line) => {
        try {
          await this.deleteLine(
            line.journalBatchNumber,
            line.lineNumber,
            dataAreaId,
          );
          return {
            journalBatchNumber: line.journalBatchNumber,
            lineNumber: line.lineNumber,
            success: true,
          };
        } catch (error) {
          const errorMessage = this.dfoErrorExtractor.extractMessage(error);
          this.logger.error(
            `Failed to delete line ${line.lineNumber} for journal ${line.journalBatchNumber}: ${errorMessage}`,
          );
          return {
            journalBatchNumber: line.journalBatchNumber,
            lineNumber: line.lineNumber,
            success: false,
            error: errorMessage,
          };
        }
      });

      const chunkResults = await Promise.all(deletePromises);
      results.push(...chunkResults);
    }

    const successCount = results.filter((r) => r.success).length;
    this.logger.debug(
      `Line deletion completed: ${successCount} succeeded, ${results.length - successCount} failed`,
    );

    return results;
  }
}
