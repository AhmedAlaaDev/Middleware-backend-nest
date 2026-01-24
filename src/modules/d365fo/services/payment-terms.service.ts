import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

import { D365FOPaymentTerm } from '@/modules/d365fo/types';

/**
 * Service for managing payment terms in D365FO
 */
@Injectable()
export class PaymentTermsService {
  private readonly logger = new Logger(PaymentTermsService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

  /**
   * Get payment terms list for a specific company
   */
  public async getPaymentTermsList(
    company: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
      filters?: string | string[];
    },
  ): Promise<D365FOPaymentTerm[]> {
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

    const query = this.queryBuilder.buildQuery('/data/PaymentTerms', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(`Fetching payment terms list for company: ${company}`);

    const response = await this.d365foClient.get<D365FOPaymentTerm>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value;
  }

  /**
   * Get all payment terms for a specific company with automatic pagination.
   * This method handles pagination internally and fetches all payment terms regardless of count.
   */
  public async getAllPaymentTerms(
    company: string,
    options?: {
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
      filters?: string | string[];
    },
  ): Promise<D365FOPaymentTerm[]> {
    const { useCache = true, select, orderBy, filters } = options || {};

    const allPaymentTerms: D365FOPaymentTerm[] = [];
    let skipCount = 0;
    const pageSize = 1000;
    let hasMore = true;

    this.logger.debug(
      `Fetching all payment terms for company: ${company} (with pagination)`,
    );

    while (hasMore) {
      const paymentTerms = await this.getPaymentTermsList(company, {
        skipCount: skipCount,
        maxCount: pageSize,
        useCache: useCache,
        select: select,
        orderBy: orderBy,
        filters: filters,
      });

      if (paymentTerms.length === 0) {
        hasMore = false;
      } else {
        allPaymentTerms.push(...paymentTerms);
        skipCount += pageSize;
        if (paymentTerms.length < pageSize) {
          hasMore = false;
        }
      }
    }

    this.logger.debug(
      `Fetched ${allPaymentTerms.length} total payment terms for company: ${company}`,
    );

    return allPaymentTerms;
  }
}
