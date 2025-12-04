import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

import { D365FOCustomer } from '@/modules/d365fo/types';

/**
 * Service for managing customers in D365FO
 */
@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) { }

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
  ): Promise<D365FOCustomer[]> {
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

    const response = await this.d365foClient.get<D365FOCustomer>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value;
  }

  /**
   * Get all customers for a specific company with automatic pagination.
   * This method handles pagination internally and fetches all customers regardless of count.
   */
  public async getAllCustomers(
    company: string,
    options?: {
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
      filters?: string | string[];
    },
  ): Promise<D365FOCustomer[]> {
    const { useCache = true, select, orderBy, filters } = options || {};

    const allCustomers: D365FOCustomer[] = [];
    let skipCount = 0;
    const pageSize = 1000;
    let hasMore = true;

    this.logger.debug(
      `Fetching all customers for company: ${company} (with pagination)`,
    );

    while (hasMore) {
      const customers = await this.getCustomerList(company, {
        skipCount: skipCount,
        maxCount: pageSize,
        useCache: useCache,
        select: select,
        orderBy: orderBy,
        filters: filters,
      });

      if (customers.length === 0) {
        hasMore = false;
      } else {
        allCustomers.push(...customers);
        skipCount += pageSize;
        if (customers.length < pageSize) {
          hasMore = false;
        }
      }
    }

    this.logger.debug(
      `Fetched ${allCustomers.length} total customers for company: ${company}`,
    );

    return allCustomers;
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
  ): Promise<D365FOCustomer | null> {
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

    const response = await this.d365foClient.get<D365FOCustomer>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value.length > 0 ? response.value[0] : null;
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
  ): Promise<D365FOCustomer[]> {
    const {
      skipCount = 0,
      maxCount = 50,
      useCache = true,
      select,
    } = options || {};

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', company),
      this.queryBuilder.or(
        this.queryBuilder.contains('Name', searchTerm),
        this.queryBuilder.contains('CustomerAccount', searchTerm),
      ),
    );

    const query = this.queryBuilder.buildQuery('/data/Customers', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy: 'Name',
      crossCompany: true,
    });

    this.logger.debug(
      `Searching customers for company: ${company}, term: ${searchTerm}`,
    );

    const response = await this.d365foClient.get<D365FOCustomer>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value;
  }
}
