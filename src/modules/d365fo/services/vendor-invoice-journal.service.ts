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
   * @returns Array of successfully posted line identifiers
   * @throws Error if any line fails - caller should rollback headers and successfully posted lines
   */
  public async postLinesBatch(
    lines: D365FOVendorInvoiceJournalLineRequest[],
    chunkSize: number = 20,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    this.logger.debug(
      `Posting ${lines.length} lines in chunks of ${chunkSize}`,
    );

    const successfullyPosted: Array<{
      headerId: string;
      lineNumber: number;
    }> = [];

    // Process in chunks
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.debug(
        `Posting chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
      );

      try {
        // Post lines in parallel within chunk, tracking successes
        const chunkPromises = chunk.map(async (line) => {
          await this.postLine(line);
          return {
            headerId: line.JournalBatchNumber,
            lineNumber: line.LineNumber,
          };
        });

        const chunkResults = await Promise.all(chunkPromises);
        successfullyPosted.push(...chunkResults);

        this.logger.debug(
          `Successfully posted chunk ${chunkNumber} (${chunk.length} lines)`,
        );
      } catch (error) {
        const errorDetails = this.extractErrorDetails(error);

        // Log full error response for debugging
        if (error?.response?.data) {
          this.logger.error(
            `D365FO error response: ${JSON.stringify(error.response.data)}`,
          );
        }

        this.logger.error(
          `Failed to post chunk ${chunkNumber} of ${totalChunks}: ${errorDetails}`,
          error instanceof Error ? error.stack : undefined,
        );

        // Build error message based on what was actually posted
        let errorMessage = `Failed to post lines in chunk ${chunkNumber}: ${errorDetails}`;

        if (successfullyPosted.length > 0) {
          errorMessage += `. ${successfullyPosted.length} lines were posted successfully before failure. Rollback required.`;
          this.logger.warn(
            `Successfully posted ${successfullyPosted.length} lines before failure. Rollback required.`,
          );
        } else {
          errorMessage += `. No lines were posted successfully.`;
          this.logger.warn(
            `No lines were posted successfully in chunk ${chunkNumber}. Only headers need rollback.`,
          );
        }

        // Re-throw to trigger rollback in processor
        throw new Error(errorMessage);
      }
    }

    this.logger.debug(
      `Successfully posted all ${lines.length} lines (${successfullyPosted.length} tracked)`,
    );

    return successfullyPosted;
  }

  /**
   * Extracts detailed error message from D365FO API error response
   */
  private extractErrorDetails(error: any): string {
    // Check for D365FO OData error format
    if (error?.response?.data?.error) {
      const d365foError = error.response.data.error;

      // OData error format: { code: "...", message: "...", innererror: { message: "..." } }
      if (typeof d365foError === 'object') {
        // Prioritize innererror.message as it contains the detailed error message
        const innerErrorMessage = d365foError.innererror?.message;
        const genericMessage = d365foError.message;
        const code = d365foError.code;

        // Use innererror message if available (more detailed), otherwise fallback to generic message
        const message = innerErrorMessage || genericMessage || d365foError.code;

        if (message) {
          return code ? `[${code}] ${message}` : message;
        }

        // If message is not directly available, try to stringify the error object
        try {
          return JSON.stringify(d365foError);
        } catch {
          return String(d365foError);
        }
      }

      // If error is a string
      if (typeof d365foError === 'string') {
        return d365foError;
      }
    }

    // Fallback to standard error message extraction
    if (error?.response?.data?.error_description) {
      return error.response.data.error_description;
    }

    if (error?.response?.data?.message) {
      return error.response.data.message;
    }

    if (error?.message) {
      return error.message;
    }

    if (error?.response?.statusText) {
      return `HTTP ${error.response.status}: ${error.response.statusText}`;
    }

    return String(error);
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
    const response = await this.d365foClient.delete(endpoint);

    // Verify deletion response (should be empty or 204)
    if (response !== undefined && response !== null) {
      this.logger.debug(`Header ${journalBatchNumber} deleted successfully`);
    }
  }

  /**
   * Delete a vendor invoice journal line (for rollback)
   * @param journalBatchNumber The JournalBatchNumber of the line to delete
   * @param lineNumber The LineNumber of the line to delete
   * @param dataAreaId The company data area ID
   */
  public async deleteLine(
    journalBatchNumber: string,
    lineNumber: number,
    dataAreaId: string,
  ): Promise<void> {
    this.logger.debug(
      `Deleting vendor invoice journal line ${lineNumber} for journal ${journalBatchNumber} in company: ${dataAreaId}`,
    );

    // Format: /data/VendInvoiceJournalLines(dataAreaId='m-p',JournalBatchNumber='Mesco-000010002',LineNumber=1)?cross-company=true
    const endpoint = `/data/VendInvoiceJournalLines(dataAreaId='${dataAreaId}',JournalBatchNumber='${journalBatchNumber}',LineNumber=${lineNumber})?cross-company=true`;
    const response = await this.d365foClient.delete(endpoint);

    // Verify deletion response (should be empty or 204)
    if (response !== undefined && response !== null) {
      this.logger.debug(
        `Line ${lineNumber} for journal ${journalBatchNumber} deleted successfully`,
      );
    }
  }

  /**
   * Delete multiple vendor invoice journal lines in chunks
   * @param lines Array of line identifiers to delete
   * @param dataAreaId The company data area ID
   * @param chunkSize Number of lines to delete per chunk (default: 20)
   * @returns Array of results indicating success/failure for each line
   */
  public async deleteLinesBatch(
    lines: Array<{ journalBatchNumber: string; lineNumber: number }>,
    dataAreaId: string,
    chunkSize: number = 20,
  ): Promise<
    Array<{
      journalBatchNumber: string;
      lineNumber: number;
      success: boolean;
      error?: string;
    }>
  > {
    this.logger.debug(
      `Deleting ${lines.length} lines in chunks of ${chunkSize}`,
    );

    const results: Array<{
      journalBatchNumber: string;
      lineNumber: number;
      success: boolean;
      error?: string;
    }> = [];

    // Process in chunks
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.debug(
        `Deleting chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
      );

      // Delete lines in parallel within chunk
      const deletePromises = chunk.map(async (line) => {
        try {
          await this.deleteLine(
            line.journalBatchNumber,
            line.lineNumber,
            dataAreaId,
          );
          return {
            journalBatchNumber: line.journalBatchNumber,
            lineNumber: line.lineNumber,
            success: true,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to delete line ${line.lineNumber} for journal ${line.journalBatchNumber}: ${errorMessage}`,
          );
          return {
            journalBatchNumber: line.journalBatchNumber,
            lineNumber: line.lineNumber,
            success: false,
            error: errorMessage,
          };
        }
      });

      const chunkResults = await Promise.all(deletePromises);
      results.push(...chunkResults);
    }

    const successCount = results.filter((r) => r.success).length;
    this.logger.debug(
      `Line deletion completed: ${successCount} succeeded, ${results.length - successCount} failed`,
    );

    return results;
  }
}
