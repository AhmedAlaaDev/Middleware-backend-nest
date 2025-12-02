import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

/**
 * Service for managing customers in D365FO
 */
@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

  /**
   * Get customer list for a specific company
   */
  public async getCustomerList(
    company: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
      filters?: string | string[];
    },
  ): Promise<any[]> {
    const {
      skipCount = 0,
      maxCount = 50,
      useCache = true,
      select,
      orderBy,
      filters,
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

    const query = this.queryBuilder.buildQuery('/data/Customers', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(`Fetching customer list for company: ${company}`);

    return this.d365foClient.get<any[]>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });
  }

  /**
   * Get a single customer by account number
   */
  public async getCustomerByAccount(
    company: string,
    customerAccount: string,
    options?: {
      useCache?: boolean;
      select?: string[];
      expand?: string | string[];
    },
  ): Promise<any> {
    const { useCache = true, select, expand } = options || {};

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', company),
      this.queryBuilder.eq('CustomerAccount', customerAccount),
    );

    const query = this.queryBuilder.buildQuery('/data/Customers', {
      filter,
      select,
      expand,
      crossCompany: true,
      top: 1,
    });

    this.logger.debug(
      `Fetching customer ${customerAccount} for company: ${company}`,
    );

    const results = await this.d365foClient.get<any[]>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return results.length > 0 ? results[0] : null;
  }

  /**
   * Search customers by name or account
   */
  public async searchCustomers(
    company: string,
    searchTerm: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
    },
  ): Promise<any[]> {
    const { skipCount = 0, maxCount = 50, useCache = true, select } =
      options || {};

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', company),
      this.queryBuilder.or(
        this.queryBuilder.contains('CustomerName', searchTerm),
        this.queryBuilder.contains('CustomerAccount', searchTerm),
      ),
    );

    const query = this.queryBuilder.buildQuery('/data/Customers', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy: 'CustomerName',
      crossCompany: true,
    });

    this.logger.debug(
      `Searching customers for company: ${company}, term: ${searchTerm}`,
    );

    return this.d365foClient.get<any[]>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });
  }
}

