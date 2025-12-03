import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

import { D365FOMainAccount } from '@/modules/d365fo/types';

/**
 * Service for managing chart of accounts and main accounts in D365FO
 */
@Injectable()
export class ChartOfAccountsService {
  private readonly logger = new Logger(ChartOfAccountsService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

  /**
   * Get main accounts for a specific chart of accounts
   * Note: This method returns up to maxCount accounts. For fetching all accounts,
   * use getAllMainAccounts() which handles pagination automatically.
   */
  public async getMainAccounts(
    chartOfAccounts: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
      filters?: string;
    },
  ): Promise<D365FOMainAccount[]> {
    const {
      skipCount = 0,
      maxCount = 5000,
      useCache = true,
      select,
      orderBy,
      filters,
    } = options || {};

    const baseFilter = this.queryBuilder.eq('ChartOfAccounts', chartOfAccounts);
    const filter = filters
      ? this.queryBuilder.and(
          baseFilter,
          Array.isArray(filters)
            ? this.queryBuilder.buildFilterExpression(filters)
            : filters,
        )
      : baseFilter;

    const query = this.queryBuilder.buildQuery('/data/MainAccounts', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(
      `Fetching main accounts for chart of accounts: ${chartOfAccounts}`,
    );

    const response = await this.d365foClient.get<D365FOMainAccount>(query, {
      useCache,
      cacheTtl: 60 * 60 * 1000, // 1 hour - accounts don't change often
    });

    return response.value;
  }

  /**
   * Get all main accounts for a specific chart of accounts with automatic pagination.
   * This method handles pagination internally and fetches all accounts regardless of count.
   */
  public async getAllMainAccounts(
    chartOfAccounts: string,
    options?: {
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
      filters?: string;
    },
  ): Promise<D365FOMainAccount[]> {
    const { useCache = true, select, orderBy, filters } = options || {};

    const allAccounts: D365FOMainAccount[] = [];
    let skipCount = 0;
    const pageSize = 5000;
    let hasMore = true;

    this.logger.debug(
      `Fetching all main accounts for chart of accounts: ${chartOfAccounts} (with pagination)`,
    );

    while (hasMore) {
      const accounts = await this.getMainAccounts(chartOfAccounts, {
        skipCount,
        maxCount: pageSize,
        useCache,
        select,
        orderBy,
        filters,
      });

      if (accounts.length === 0) {
        hasMore = false;
      } else {
        allAccounts.push(...accounts);
        skipCount += pageSize;
        // If we got less than pageSize, we've reached the end
        if (accounts.length < pageSize) {
          hasMore = false;
        }
      }
    }

    this.logger.debug(
      `Fetched ${allAccounts.length} total main accounts for chart of accounts: ${chartOfAccounts}`,
    );

    return allAccounts;
  }

  /**
   * Get a single main account by ID and chart of accounts
   */
  public async getMainAccountById(
    chartOfAccounts: string,
    mainAccountId: string,
    options?: {
      useCache?: boolean;
      select?: string[];
    },
  ): Promise<D365FOMainAccount | null> {
    const { useCache = true, select } = options || {};

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('ChartOfAccounts', chartOfAccounts),
      this.queryBuilder.eq('MainAccountId', mainAccountId),
    );

    const query = this.queryBuilder.buildQuery('/data/MainAccounts', {
      filter,
      top: 1,
      select,
      crossCompany: true,
    });

    this.logger.debug(
      `Fetching main account ${mainAccountId} for chart of accounts: ${chartOfAccounts}`,
    );

    const response = await this.d365foClient.get<D365FOMainAccount>(query, {
      useCache,
      cacheTtl: 60 * 60 * 1000, // 1 hour
    });

    return response.value.length > 0 ? response.value[0] : null;
  }

  /**
   * Search main accounts by name or account ID
   */
  public async searchMainAccounts(
    chartOfAccounts: string,
    searchTerm: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
    },
  ): Promise<D365FOMainAccount[]> {
    const {
      skipCount = 0,
      maxCount = 100,
      useCache = true,
      select,
      orderBy,
    } = options || {};

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('ChartOfAccounts', chartOfAccounts),
      this.queryBuilder.or(
        this.queryBuilder.contains('MainAccountId', searchTerm),
        this.queryBuilder.contains('Name', searchTerm),
      ),
    );

    const query = this.queryBuilder.buildQuery('/data/MainAccounts', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(
      `Searching main accounts for chart of accounts: ${chartOfAccounts}, term: ${searchTerm}`,
    );

    const response = await this.d365foClient.get<D365FOMainAccount>(query, {
      useCache,
      cacheTtl: 60 * 60 * 1000, // 1 hour
    });

    return response.value;
  }
}
