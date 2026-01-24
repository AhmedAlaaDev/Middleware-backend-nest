import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';

import {
  D365FOVendorInvoiceJournalHeaderRequest,
  D365FOVendorInvoiceJournalHeaderResponse,
  D365FOVendorInvoiceJournalLineRequest,
} from '@/modules/d365fo/types';

/**
 * Service for managing vendor invoice journals in D365FO
 */
@Injectable()
export class VendorInvoiceJournalService {
  private readonly logger = new Logger(VendorInvoiceJournalService.name);

  constructor(private readonly d365foClient: D365FOClientService) {}

  /**
   * Post vendor invoice journal header to D365FO
   */
  public async postHeader(
    data: D365FOVendorInvoiceJournalHeaderRequest,
  ): Promise<D365FOVendorInvoiceJournalHeaderResponse> {
    this.logger.debug(
      `Posting vendor invoice journal header for company: ${data.dataAreaId}, batch: ${data.JournalBatchNumber}`,
    );

    return this.d365foClient.post<
      D365FOVendorInvoiceJournalHeaderRequest,
      D365FOVendorInvoiceJournalHeaderResponse
    >('/data/VendInvoiceJournalHeaders', data);
  }

  /**
   * Post vendor invoice journal line to D365FO
   */
  public async postLine(
    data: D365FOVendorInvoiceJournalLineRequest,
  ): Promise<any> {
    this.logger.debug(
      `Posting vendor invoice journal line for company: ${data.dataAreaId}, batch: ${data.JournalBatchNumber}, line: ${data.LineNumber}`,
    );

    // Remove FullPrimaryRemittanceAddress from line body before posting
    const { FullPrimaryRemittanceAddress, ...lineData } = data as any;

    return this.d365foClient.post<any, any>(
      '/data/VendInvoiceJournalLines',
      lineData,
    );
  }

  /**
   * Post multiple vendor invoice journal headers in chunks
   * @param headers Array of header requests
   * @param chunkSize Number of headers to post per chunk (default: 10)
   * @returns Array of JournalBatchNumbers (as strings)
   */
  public async postHeadersBatch(
    headers: D365FOVendorInvoiceJournalHeaderRequest[],
    chunkSize: number = 10,
  ): Promise<string[]> {
    this.logger.debug(
      `Posting ${headers.length} headers in chunks of ${chunkSize}`,
    );

    const journalBatchNumbers: string[] = [];

    // Process in chunks
    for (let i = 0; i < headers.length; i += chunkSize) {
      const chunk = headers.slice(i, i + chunkSize);
      this.logger.debug(
        `Posting chunk ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(headers.length / chunkSize)} (${chunk.length} headers)`,
      );

      // Post headers in parallel within chunk
      const chunkPromises = chunk.map((header) => this.postHeader(header));
      const chunkResults = await Promise.all(chunkPromises);

      // Extract JournalBatchNumbers from responses
      for (const result of chunkResults) {
        const journalBatchNumber = result?.JournalBatchNumber;
        if (journalBatchNumber) {
          journalBatchNumbers.push(journalBatchNumber);
        } else {
          this.logger.warn(
            'Header posted but JournalBatchNumber not found in response',
            JSON.stringify(result),
          );
        }
      }
    }

    this.logger.debug(
      `Successfully posted ${journalBatchNumbers.length} headers`,
    );
    return journalBatchNumbers;
  }

  /**
   * Post multiple vendor invoice journal lines in chunks
   * @param lines Array of line requests
   * @param chunkSize Number of lines to post per chunk (default: 20)
   * @throws Error if any line fails - caller should rollback headers
   */
  public async postLinesBatch(
    lines: D365FOVendorInvoiceJournalLineRequest[],
    chunkSize: number = 20,
  ): Promise<void> {
    this.logger.debug(
      `Posting ${lines.length} lines in chunks of ${chunkSize}`,
    );

    // Process in chunks
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.debug(
        `Posting chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
      );

      try {
        // Post lines in parallel within chunk
        // If ANY line fails, Promise.all will reject and we'll throw
        const chunkPromises = chunk.map((line) => this.postLine(line));
        await Promise.all(chunkPromises);

        this.logger.debug(
          `Successfully posted chunk ${chunkNumber} (${chunk.length} lines)`,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to post chunk ${chunkNumber} of ${totalChunks}: ${errorMessage}`,
        );
        // Re-throw to trigger rollback in processor
        throw new Error(
          `Failed to post lines in chunk ${chunkNumber}: ${errorMessage}. Previous chunks may have been posted successfully. Rollback required.`,
        );
      }
    }

    this.logger.debug(`Successfully posted all ${lines.length} lines`);
  }

  /**
   * Delete a vendor invoice journal header (for rollback)
   * @param journalBatchNumber The JournalBatchNumber of the header to delete
   * @param dataAreaId The company data area ID
   */
  public async deleteHeader(
    journalBatchNumber: string,
    dataAreaId: string,
  ): Promise<void> {
    this.logger.debug(
      `Deleting vendor invoice journal header ${journalBatchNumber} for company: ${dataAreaId}`,
    );

    // D365FO uses JournalBatchNumber for deletion
    // Format: /data/VendInvoiceJournalHeaders(dataAreaId='m-p',JournalBatchNumber='Mesco-000001956')
    const endpoint = `/data/VendInvoiceJournalHeaders(dataAreaId='${dataAreaId}',JournalBatchNumber='${journalBatchNumber}')?cross-company=true`;
    await this.d365foClient.delete(endpoint);
  }
}
