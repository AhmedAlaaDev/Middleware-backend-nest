import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';

/**
 * Service for managing billing codes and billing classifications in D365FO
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly d365foClient: D365FOClientService) {}

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
    },
  ): Promise<any[]> {
    const { skipCount = 0, maxCount = 5000, useCache = true } = options || {};

    const query = `/data/BillingClassificationCodes?cross-company=true&$filter=dataAreaId eq '${company}' and BillingClassification eq '${billingClassId}'&$top=${maxCount}&$skip=${skipCount}`;

    this.logger.debug(
      `Fetching billing codes for company: ${company}, class: ${billingClassId}`,
    );

    return this.d365foClient.get<any[]>(query, {
      useCache,
      cacheTtl: 30 * 60 * 1000, // 30 minutes
    });
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
    },
  ): Promise<any[]> {
    const { skipCount = 0, maxCount = 5000, useCache = true } = options || {};

    const query = `/data/BillingClassifications?cross-company=true&$filter=dataAreaId eq '${company}'&$top=${maxCount}&$skip=${skipCount}`;

    this.logger.debug(`Fetching billing classifications for company: ${company}`);

    return this.d365foClient.get<any[]>(query, {
      useCache,
      cacheTtl: 30 * 60 * 1000, // 30 minutes
    });
  }
}

