import { Injectable, Logger } from '@nestjs/common';

import {
  D365FODimension,
  D365FODimensionValue,
} from '@/modules/d365fo/types/d365fo-dimension.type';
import { D365FOODataResponse } from '@/modules/d365fo/types/d365fo-odata.type';
import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

/**
 * Service for managing financial dimensions and dimension values in D365FO
 */
@Injectable()
export class DimensionService {
  private readonly logger = new Logger(DimensionService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

  /**
   * Get dimension list
   */
  public async getDimensionList(options?: {
    skipCount?: number;
    maxCount?: number;
    useCache?: boolean;
    select?: string[];
    orderBy?: string | string[];
    filter?: string;
  }): Promise<D365FOODataResponse<D365FODimension>> {
    const {
      skipCount = 0,
      maxCount = 5000,
      useCache = true,
      select,
      orderBy,
      filter,
    } = options || {};

    const query = this.queryBuilder.buildQuery('/data/DimensionAttributes', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug('Fetching dimension list');

    return this.d365foClient.get<D365FODimension>(query, {
      useCache,
      cacheTtl: 60 * 60 * 1000, // 1 hour - dimensions don't change often
    });
  }

  /**
   * Get dimension value list for a specific dimension and company
   */
  public async getDimensionValueList(
    dimension: string,
    company: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
    },
  ): Promise<D365FOODataResponse<D365FODimensionValue>> {
    const { skipCount = 0, maxCount = 5000, useCache = true, select, orderBy } =
      options || {};

    // Filter: (LegalEntityId eq 'company' and FinancialDimension eq 'dimension') or (LegalEntityId eq '' and FinancialDimension eq 'dimension')
    const filter = this.queryBuilder.or(
      this.queryBuilder.and(
        this.queryBuilder.eq('LegalEntityId', company),
        this.queryBuilder.eq('FinancialDimension', dimension),
      ),
      this.queryBuilder.and(
        this.queryBuilder.eq('LegalEntityId', ''),
        this.queryBuilder.eq('FinancialDimension', dimension),
      ),
    );

    const query = this.queryBuilder.buildQuery(
      '/data/FinancialDimensionValues',
      {
        filter,
        top: maxCount,
        skip: skipCount,
        select,
        orderBy,
        crossCompany: true,
      },
    );

    this.logger.debug(
      `Fetching dimension values for dimension: ${dimension}, company: ${company}`,
    );

    return this.d365foClient.get<D365FODimensionValue>(query, {
      useCache,
      cacheTtl: 30 * 60 * 1000, // 30 minutes
    });
  }
}

