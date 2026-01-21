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

  /**
   * Post multiple free text invoice headers in chunks
   * @param headers Array of header requests
   * @param chunkSize Number of headers to post per chunk (default: 10)
   * @returns Array of header IDs (InvoiceIdentifier as strings)
   */
  public async postHeadersBatch(
    headers: D365FOFreeTextInvoiceHeaderRequest[],
    chunkSize: number = 10,
  ): Promise<string[]> {
    this.logger.debug(
      `Posting ${headers.length} headers in chunks of ${chunkSize}`,
    );

    const headerIds: string[] = [];

    // Process in chunks
    for (let i = 0; i < headers.length; i += chunkSize) {
      const chunk = headers.slice(i, i + chunkSize);
      this.logger.debug(
        `Posting chunk ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(headers.length / chunkSize)} (${chunk.length} headers)`,
      );

      // Post headers in parallel within chunk
      const chunkPromises = chunk.map((header) => this.postHeader(header));
      const chunkResults = await Promise.all(chunkPromises);

      // Extract IDs from responses
      for (const result of chunkResults) {
        // InvoiceIdentifier is a number in the response
        const invoiceIdentifier = result?.InvoiceIdentifier;
        if (invoiceIdentifier !== undefined && invoiceIdentifier !== null) {
          headerIds.push(String(invoiceIdentifier));
        } else {
          this.logger.warn(
            'Header posted but InvoiceIdentifier not found in response',
            JSON.stringify(result),
          );
        }
      }
    }

    this.logger.debug(`Successfully posted ${headerIds.length} headers`);
    return headerIds;
  }

  /**
   * Post multiple free text invoice lines in chunks
   * @param lines Array of line requests
   * @param chunkSize Number of lines to post per chunk (default: 20)
   */
  public async postLinesBatch(
    lines: D365FOFreeTextInvoiceLineRequest[],
    chunkSize: number = 20,
  ): Promise<void> {
    this.logger.debug(
      `Posting ${lines.length} lines in chunks of ${chunkSize}`,
    );

    // Process in chunks
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      this.logger.debug(
        `Posting chunk ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(lines.length / chunkSize)} (${chunk.length} lines)`,
      );

      // Post lines in parallel within chunk
      const chunkPromises = chunk.map((line) => this.postLine(line));
      await Promise.all(chunkPromises);
    }

    this.logger.debug(`Successfully posted ${lines.length} lines`);
  }

  /**
   * Delete a free text invoice header (for rollback)
   * @param headerId The InvoiceIdentifier of the header to delete (as string)
   * @param dataAreaId The company data area ID
   */
  public async deleteHeader(
    headerId: string,
    dataAreaId: string,
  ): Promise<void> {
    this.logger.debug(
      `Deleting free text invoice header ${headerId} for company: ${dataAreaId}`,
    );

    // D365FO uses InvoiceIdentifier for deletion
    // Format: /data/FreeTextInvoiceHeaders(dataAreaId='m-p',InvoiceIdentifier=5637743016)
    const endpoint = `/data/FreeTextInvoiceHeaders(dataAreaId='${dataAreaId}',InvoiceIdentifier=${headerId})`;
    await this.d365foClient.delete(endpoint);
  }
}
