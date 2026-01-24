import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

import { D365FOLedger } from '@/modules/d365fo/types';

/**
 * Service for managing ledgers in D365FO
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

  /**
   * Get ledgers list for a specific company
   */
  public async getLedgersList(
    company: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
      filters?: string | string[];
    },
  ): Promise<D365FOLedger[]> {
    const {
      skipCount = 0,
      maxCount = 2500,
      useCache = true,
      select,
      orderBy,
      filters,
    } = options || {};

    const baseFilter = this.queryBuilder.eq('LegalEntityId', company);
    const filter = filters
      ? this.queryBuilder.and(
          baseFilter,
          Array.isArray(filters)
            ? this.queryBuilder.buildFilterExpression(filters)
            : filters,
        )
      : baseFilter;

    const query = this.queryBuilder.buildQuery('/data/Ledgers', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(`Fetching ledgers list for company: ${company}`);

    const response = await this.d365foClient.get<D365FOLedger>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value;
  }

  /**
   * Get all ledgers for a specific company with automatic pagination.
   * This method handles pagination internally and fetches all ledgers regardless of count.
   */
  public async getAllLedgers(
    company: string,
    options?: {
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
      filters?: string | string[];
    },
  ): Promise<D365FOLedger[]> {
    const { useCache = true, select, orderBy, filters } = options || {};

    const allLedgers: D365FOLedger[] = [];
    let skipCount = 0;
    const pageSize = 1000;
    let hasMore = true;

    this.logger.debug(
      `Fetching all ledgers for company: ${company} (with pagination)`,
    );

    while (hasMore) {
      const ledgers = await this.getLedgersList(company, {
        skipCount: skipCount,
        maxCount: pageSize,
        useCache: useCache,
        select: select,
        orderBy: orderBy,
        filters: filters,
      });

      if (ledgers.length === 0) {
        hasMore = false;
      } else {
        allLedgers.push(...ledgers);
        skipCount += pageSize;
        if (ledgers.length < pageSize) {
          hasMore = false;
        }
      }
    }

    this.logger.debug(
      `Fetched ${allLedgers.length} total ledgers for company: ${company}`,
    );

    return allLedgers;
  }
}
