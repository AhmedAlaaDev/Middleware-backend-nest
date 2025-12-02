import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';

/**
 * Service for managing financial dimensions and dimension values in D365FO
 */
@Injectable()
export class DimensionService {
  private readonly logger = new Logger(DimensionService.name);

  constructor(private readonly d365foClient: D365FOClientService) {}

  /**
   * Get dimension list
   */
  public async getDimensionList(options?: {
    skipCount?: number;
    maxCount?: number;
    useCache?: boolean;
  }): Promise<any[]> {
    const { skipCount = 0, maxCount = 5000, useCache = true } = options || {};

    const query = `/data/DimensionAttributes?cross-company=true&$top=${maxCount}&$skip=${skipCount}`;

    this.logger.debug('Fetching dimension list');

    return this.d365foClient.get<any[]>(query, {
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
    },
  ): Promise<any[]> {
    const { skipCount = 0, maxCount = 5000, useCache = true } = options || {};

    const query = `/data/FinancialDimensionValues?cross-company=true&$filter=(LegalEntityId eq '${company}' and FinancialDimension eq '${dimension}') or (LegalEntityId eq '' and FinancialDimension eq '${dimension}')&$top=${maxCount}&$skip=${skipCount}`;

    this.logger.debug(
      `Fetching dimension values for dimension: ${dimension}, company: ${company}`,
    );

    return this.d365foClient.get<any[]>(query, {
      useCache,
      cacheTtl: 30 * 60 * 1000, // 30 minutes
    });
  }
}

