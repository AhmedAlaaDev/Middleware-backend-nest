import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

import { D365FOTaxItemGroupHeading } from '@/modules/d365fo/types/tax-item-group-heading.type';

/**
 * Service for fetching Item sales tax groups (TaxItemGroupHeadings) from D365FO.
 */
@Injectable()
export class TaxItemGroupHeadingService {
  private readonly logger = new Logger(TaxItemGroupHeadingService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

  /**
   * Get TaxItemGroupHeadings list with optional company filter.
   * Uses cross-company=true so all companies are returned unless filtered.
   */
  public async getTaxItemGroupHeadingsList(options?: {
    company?: string;
    skipCount?: number;
    maxCount?: number;
    useCache?: boolean;
  }): Promise<D365FOTaxItemGroupHeading[]> {
    const {
      company,
      skipCount = 0,
      maxCount = 5000,
      useCache = false,
    } = options || {};

    const filter = company
      ? this.queryBuilder.eq('dataAreaId', company)
      : undefined;

    const query = this.queryBuilder.buildQuery('/data/TaxItemGroupHeadings', {
      filter,
      top: maxCount,
      skip: skipCount,
      crossCompany: true,
    });

    this.logger.debug(
      `Fetching TaxItemGroupHeadings${company ? ` for company: ${company}` : ''}`,
    );

    const response = await this.d365foClient.get<D365FOTaxItemGroupHeading>(
      query,
      { useCache, cacheTtl: 5 * 60 * 1000 },
    );

    return response.value;
  }

  /**
   * Get all TaxItemGroupHeadings with automatic pagination.
   */
  public async getAllTaxItemGroupHeadings(
    company?: string,
    options?: { useCache?: boolean },
  ): Promise<D365FOTaxItemGroupHeading[]> {
    const { useCache = false } = options || {};
    const all: D365FOTaxItemGroupHeading[] = [];
    let skipCount = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const page = await this.getTaxItemGroupHeadingsList({
        company,
        skipCount,
        maxCount: pageSize,
        useCache,
      });
      if (page.length === 0) break;
      all.push(...page);
      skipCount += pageSize;
      if (page.length < pageSize) hasMore = false;
    }

    this.logger.debug(
      `Fetched ${all.length} TaxItemGroupHeadings${company ? ` for company: ${company}` : ''}`,
    );
    return all;
  }
}
