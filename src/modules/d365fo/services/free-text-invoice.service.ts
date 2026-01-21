import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';

import {
  D365FOFreeTextInvoiceHeaderRequest,
  D365FOFreeTextInvoiceLineRequest,
} from '@/modules/d365fo/types';

/**
 * Service for managing free text invoices in D365FO
 */
@Injectable()
export class FreeTextInvoiceService {
  private readonly logger = new Logger(FreeTextInvoiceService.name);

  constructor(private readonly d365foClient: D365FOClientService) {}

  /**
   * Post free text invoice header to D365FO
   */
  public async postHeader(
    data: D365FOFreeTextInvoiceHeaderRequest,
  ): Promise<any> {
    this.logger.debug(
      `Posting free text invoice header for company: ${data.dataAreaId}`,
    );

    return this.d365foClient.post<any, any>(
      '/data/FreeTextInvoiceHeaders',
      data,
    );
  }

  /**
   * Post free text invoice line to D365FO
   */
  public async postLine(data: D365FOFreeTextInvoiceLineRequest): Promise<any> {
    this.logger.debug(
      `Posting free text invoice line for company: ${data.dataAreaId}, parent: ${data.ParentRecId}`,
    );

    return this.d365foClient.post<any, any>('/data/FreeTextInvoiceLines', data);
  }
}
