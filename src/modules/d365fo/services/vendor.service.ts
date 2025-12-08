import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

import { D365FOVendor } from '@/modules/d365fo/types';

/**
 * Service for managing vendors in D365FO
 */
@Injectable()
export class VendorService {
  private readonly logger = new Logger(VendorService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

  /**
   * Get vendor list for a specific company
   */
  public async getVendorList(
    company: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
      filters?: string | string[];
    },
  ): Promise<D365FOVendor[]> {
    const {
      skipCount = 0,
      maxCount = 2500,
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

    const query = this.queryBuilder.buildQuery('/data/VendorsV3', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(`Fetching vendor list for company: ${company}`);

    const response = await this.d365foClient.get<D365FOVendor>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value;
  }

  /**
   * Get all vendors for a specific company with automatic pagination.
   * This method handles pagination internally and fetches all vendors regardless of count.
   */
  public async getAllVendors(
    company: string,
    options?: {
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
      filters?: string | string[];
    },
  ): Promise<D365FOVendor[]> {
    const { useCache = true, select, orderBy, filters } = options || {};

    const allVendors: D365FOVendor[] = [];
    let skipCount = 0;
    const pageSize = 1000;
    let hasMore = true;

    this.logger.debug(
      `Fetching all vendors for company: ${company} (with pagination)`,
    );

    while (hasMore) {
      const vendors = await this.getVendorList(company, {
        skipCount: skipCount,
        maxCount: pageSize,
        useCache: useCache,
        select: select,
        orderBy: orderBy,
        filters: filters,
      });

      if (vendors.length === 0) {
        hasMore = false;
      } else {
        allVendors.push(...vendors);
        skipCount += pageSize;
        if (vendors.length < pageSize) {
          hasMore = false;
        }
      }
    }

    this.logger.debug(
      `Fetched ${allVendors.length} total vendors for company: ${company}`,
    );

    return allVendors;
  }

  /**
   * Get a single vendor by account number
   */
  public async getVendorByAccount(
    company: string,
    vendorAccount: string,
    options?: {
      useCache?: boolean;
      select?: string[];
      expand?: string | string[];
    },
  ): Promise<D365FOVendor | null> {
    const { useCache = true, select, expand } = options || {};

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', company),
      this.queryBuilder.eq('VendorAccountNumber', vendorAccount),
    );

    const query = this.queryBuilder.buildQuery('/data/VendorsV3', {
      filter,
      select,
      expand,
      crossCompany: true,
      top: 1,
    });

    this.logger.debug(
      `Fetching vendor ${vendorAccount} for company: ${company}`,
    );

    const response = await this.d365foClient.get<D365FOVendor>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value.length > 0 ? response.value[0] : null;
  }

  /**
   * Search vendors by name or account
   */
  public async searchVendors(
    company: string,
    searchTerm: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
    },
  ): Promise<D365FOVendor[]> {
    const {
      skipCount = 0,
      maxCount = 50,
      useCache = true,
      select,
    } = options || {};

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', company),
      this.queryBuilder.or(
        this.queryBuilder.contains('VendorOrganizationName', searchTerm),
        this.queryBuilder.contains('VendorAccountNumber', searchTerm),
        this.queryBuilder.contains('VendorSearchName', searchTerm),
      ),
    );

    const query = this.queryBuilder.buildQuery('/data/VendorsV3', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy: 'VendorOrganizationName',
      crossCompany: true,
    });

    this.logger.debug(
      `Searching vendors for company: ${company}, term: ${searchTerm}`,
    );

    const response = await this.d365foClient.get<D365FOVendor>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value;
  }
}
