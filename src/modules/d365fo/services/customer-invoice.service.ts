import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';

/**
 * Service for managing customer invoices in D365FO
 */
@Injectable()
export class CustomerInvoiceService {
  private readonly logger = new Logger(CustomerInvoiceService.name);

  constructor(private readonly d365foClient: D365FOClientService) {}

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
      filters?: string;
    },
  ): Promise<any[]> {
    const { skipCount = 0, maxCount = 100, useCache = false, filters = '' } =
      options || {};

    let query = `/data/FreeTextInvoiceHeaders?cross-company=true&$filter=dataAreaId eq '${company}'`;
    if (filters) {
      query += ` and ${filters}`;
    }
    query += `&$top=${maxCount}&$skip=${skipCount}`;

    this.logger.debug(`Fetching invoice headers for company: ${company}`);

    return this.d365foClient.get<any[]>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });
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
    },
  ): Promise<any[]> {
    const { skipCount = 0, maxCount = 1000, useCache = false } = options || {};

    const query = `/data/FreeTextInvoiceLines?cross-company=true&$filter=dataAreaId eq '${company}' and ParentRecId eq ${invoiceNumber}&$top=${maxCount}&$skip=${skipCount}`;

    this.logger.debug(
      `Fetching invoice lines for company: ${company}, invoice: ${invoiceNumber}`,
    );

    return this.d365foClient.get<any[]>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });
  }
}

