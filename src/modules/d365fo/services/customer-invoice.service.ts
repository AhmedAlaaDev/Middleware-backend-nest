import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

/**
 * Service for managing customer invoices in D365FO
 */
@Injectable()
export class CustomerInvoiceService {
  private readonly logger = new Logger(CustomerInvoiceService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

  /**
   * Create a customer invoice header
   */
  public async createInvoiceHeader(
    company: string,
    data: any,
  ): Promise<any> {
    this.logger.debug(`Creating invoice header for company: ${company}`);

    return this.d365foClient.post<any, any>('/data/FreeTextInvoiceHeaders', {
      ...data,
      DataAreaId: company,
    });
  }

  /**
   * Create a customer invoice line
   */
  public async createInvoiceLine(
    company: string,
    invoiceNumber: number,
    data: any,
  ): Promise<any> {
    this.logger.debug(
      `Creating invoice line for company: ${company}, invoice: ${invoiceNumber}`,
    );

    return this.d365foClient.post<any, any>('/data/FreeTextInvoiceLines', {
      ...data,
      DataAreaId: company,
      ParentRecId: invoiceNumber,
    });
  }

  /**
   * Get customer invoice headers
   */
  public async getInvoiceHeaders(
    company: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      filters?: string | string[];
      select?: string[];
      orderBy?: string | string[];
    },
  ): Promise<any[]> {
    const {
      skipCount = 0,
      maxCount = 100,
      useCache = false,
      filters,
      select,
      orderBy,
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

    const query = this.queryBuilder.buildQuery('/data/FreeTextInvoiceHeaders', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(`Fetching invoice headers for company: ${company}`);

    const response = await this.d365foClient.get<any>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value;
  }

  /**
   * Get customer invoice lines
   */
  public async getInvoiceLines(
    company: string,
    invoiceNumber: number,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
    },
  ): Promise<any[]> {
    const { skipCount = 0, maxCount = 1000, useCache = false, select, orderBy } =
      options || {};

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', company),
      this.queryBuilder.eq('ParentRecId', invoiceNumber),
    );

    const query = this.queryBuilder.buildQuery('/data/FreeTextInvoiceLines', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(
      `Fetching invoice lines for company: ${company}, invoice: ${invoiceNumber}`,
    );

    const response = await this.d365foClient.get<any>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value;
  }
}

