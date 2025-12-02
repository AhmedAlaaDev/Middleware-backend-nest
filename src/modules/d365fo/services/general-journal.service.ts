import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';

/**
 * Service for managing general journal entries in D365FO
 */
@Injectable()
export class GeneralJournalService {
  private readonly logger = new Logger(GeneralJournalService.name);

  constructor(private readonly d365foClient: D365FOClientService) {}

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
      filters?: string;
    },
  ): Promise<any[]> {
    const { skipCount = 0, maxCount = 100, useCache = false, filters = '' } =
      options || {};

    let query = `/data/LedgerJournalHeaders?cross-company=true&$filter=dataAreaId eq '${company}'`;
    if (filters) {
      query += ` and ${filters}`;
    }
    query += `&$top=${maxCount}&$skip=${skipCount}`;

    this.logger.debug(`Fetching journal headers for company: ${company}`);

    return this.d365foClient.get<any[]>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });
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
    },
  ): Promise<any[]> {
    const { skipCount = 0, maxCount = 1000, useCache = false } = options || {};

    const query = `/data/LedgerJournalLines?cross-company=true&$filter=dataAreaId eq '${company}' and JournalNum eq '${journalNumber}'&$top=${maxCount}&$skip=${skipCount}`;

    this.logger.debug(
      `Fetching journal lines for company: ${company}, journal: ${journalNumber}`,
    );

    return this.d365foClient.get<any[]>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });
  }
}

