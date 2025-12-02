import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

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
   * Create a general journal header
   */
  public async createJournalHeader(
    company: string,
    data: any,
  ): Promise<any> {
    this.logger.debug(`Creating journal header for company: ${company}`);

    return this.d365foClient.post<any, any>('/data/LedgerJournalHeaders', {
      ...data,
      DataAreaId: company,
    });
  }

  /**
   * Create a general journal line
   */
  public async createJournalLine(company: string, data: any): Promise<any> {
    this.logger.debug(`Creating journal line for company: ${company}`);

    return this.d365foClient.post<any, any>('/data/LedgerJournalLines', {
      ...data,
      DataAreaId: company,
    });
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
   * Get general journal lines
   */
  public async getJournalLines(
    company: string,
    journalNumber: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
    },
  ): Promise<any[]> {
    const { skipCount = 0, maxCount = 1000, useCache = false, select, orderBy } =
      options || {};

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', company),
      this.queryBuilder.eq('JournalNum', journalNumber),
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
      `Fetching journal lines for company: ${company}, journal: ${journalNumber}`,
    );

    const response = await this.d365foClient.get<any>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value;
  }
}

