import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

/**
 * Service for managing billing codes and billing classifications in D365FO
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

  /**
   * Get billing code list for a specific company and billing class
   */
  public async getBillingCodeList(
    company: string,
    billingClassId: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
    },
  ): Promise<any[]> {
    const { skipCount = 0, maxCount = 5000, useCache = true, select, orderBy } =
      options || {};

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', company),
      this.queryBuilder.eq('BillingClassification', billingClassId),
    );

    const query = this.queryBuilder.buildQuery('/data/BillingClassificationCodes', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(
      `Fetching billing codes for company: ${company}, class: ${billingClassId}`,
    );

    const response = await this.d365foClient.get<any>(query, {
      useCache,
      cacheTtl: 30 * 60 * 1000, // 30 minutes
    });

    return response.value;
  }

  /**
   * Get billing classification list for a specific company
   */
  public async getBillingClassificationList(
    company: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
    },
  ): Promise<any[]> {
    const { skipCount = 0, maxCount = 5000, useCache = true, select, orderBy } =
      options || {};

    const filter = this.queryBuilder.eq('dataAreaId', company);

    const query = this.queryBuilder.buildQuery('/data/BillingClassifications', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(`Fetching billing classifications for company: ${company}`);

    const response = await this.d365foClient.get<any>(query, {
      useCache,
      cacheTtl: 30 * 60 * 1000, // 30 minutes
    });

    return response.value;
  }
}

