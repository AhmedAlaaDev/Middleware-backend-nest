import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

import {
  LedgerJournalHeaderRequest,
  LedgerJournalHeaderResponse,
  LedgerJournalLineRequest,
  LedgerJournalLineResponse,
} from '@/modules/d365fo/types/d365fo-ledger.type';

const CROSS_COMPANY = '?cross-company=true';

/**
 * Service for managing general journal entries in D365FO
 */
@Injectable()
export class GeneralJournalService {
  private readonly logger = new Logger(GeneralJournalService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

  /**
   * Create a general journal header (cross-company)
   */
  public async createJournalHeader(
    company: string,
    data: LedgerJournalHeaderRequest,
  ): Promise<LedgerJournalHeaderResponse> {
    this.logger.debug(`Creating journal header for company: ${company}`);

    const payload = { ...data, dataAreaId: data.dataAreaId || company };
    return this.d365foClient.post<
      LedgerJournalHeaderRequest,
      LedgerJournalHeaderResponse
    >(`/data/LedgerJournalHeaders${CROSS_COMPANY}`, payload);
  }

  /**
   * Create a general journal line (cross-company)
   */
  public async createJournalLine(
    company: string,
    data: LedgerJournalLineRequest,
  ): Promise<LedgerJournalLineResponse> {
    this.logger.debug(
      `Creating journal line for company: ${company}, batch: ${data.JournalBatchNumber}`,
    );

    const payload = { ...data, dataAreaId: data.dataAreaId || company };
    return this.d365foClient.post<
      LedgerJournalLineRequest,
      LedgerJournalLineResponse
    >(`/data/LedgerJournalLines${CROSS_COMPANY}`, payload);
  }

  /**
   * Delete a general journal header (cross-company)
   * Endpoint: /data/LedgerJournalHeaders(dataAreaId='...',JournalBatchNumber='...')?cross-company=true
   */
  public async deleteJournalHeader(
    dataAreaId: string,
    journalBatchNumber: string,
  ): Promise<void> {
    this.logger.debug(
      `Deleting journal header for company: ${dataAreaId}, batch: ${journalBatchNumber}`,
    );
    const dataAreaIdEsc = this.escapeODataKey(dataAreaId);
    const batchEsc = this.escapeODataKey(journalBatchNumber);
    const endpoint = `/data/LedgerJournalHeaders(dataAreaId='${dataAreaIdEsc}',JournalBatchNumber='${batchEsc}')${CROSS_COMPANY}`;
    await this.d365foClient.delete(endpoint);
  }

  /**
   * Delete a general journal line (cross-company)
   * Endpoint: /data/LedgerJournalLines(dataAreaId='...',JournalBatchNumber='...',LineNumber=...)?cross-company=true
   */
  public async deleteJournalLine(
    dataAreaId: string,
    journalBatchNumber: string,
    lineNumber: number,
  ): Promise<void> {
    this.logger.debug(
      `Deleting journal line for company: ${dataAreaId}, batch: ${journalBatchNumber}, line: ${lineNumber}`,
    );
    const dataAreaIdEsc = this.escapeODataKey(dataAreaId);
    const batchEsc = this.escapeODataKey(journalBatchNumber);
    const endpoint = `/data/LedgerJournalLines(dataAreaId='${dataAreaIdEsc}',JournalBatchNumber='${batchEsc}',LineNumber=${lineNumber})${CROSS_COMPANY}`;
    await this.d365foClient.delete(endpoint);
  }

  /**
   * Escape single quotes in OData key string values (double the quote)
   */
  private escapeODataKey(value: string): string {
    return value.replace(/'/g, "''");
  }

  /**
   * Get general journal headers
   */
  public async getJournalHeaders(
    company: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      filters?: string | string[];
      select?: string[];
      orderBy?: string | string[];
    },
  ): Promise<any[]> {
    const {
      skipCount = 0,
      maxCount = 100,
      useCache = false,
      filters,
      select,
      orderBy,
    } = options || {};

    const baseFilter = this.queryBuilder.eq('dataAreaId', company);
    const filter = filters
      ? this.queryBuilder.and(
          baseFilter,
          Array.isArray(filters)
            ? this.queryBuilder.buildFilterExpression(filters)
            : filters,
        )
      : baseFilter;

    const query = this.queryBuilder.buildQuery('/data/LedgerJournalHeaders', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(`Fetching journal headers for company: ${company}`);

    const response = await this.d365foClient.get<any>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value;
  }

  /**
   * Get general journal lines by JournalBatchNumber (LedgerJournalLines uses JournalBatchNumber)
   */
  public async getJournalLines(
    company: string,
    journalBatchNumber: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
    },
  ): Promise<any[]> {
    const {
      skipCount = 0,
      maxCount = 1000,
      useCache = false,
      select,
      orderBy,
    } = options || {};

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', company),
      this.queryBuilder.eq('JournalBatchNumber', journalBatchNumber),
    );

    const query = this.queryBuilder.buildQuery('/data/LedgerJournalLines', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(
      `Fetching journal lines for company: ${company}, batch: ${journalBatchNumber}`,
    );

    const response = await this.d365foClient.get<any>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value;
  }
}
