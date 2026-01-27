import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { DfoErrorExtractorService } from './dfo-error-extractor.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

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

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
    private readonly dfoErrorExtractor: DfoErrorExtractorService,
  ) {}

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
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(headers.length / chunkSize);
      this.logger.debug(
        `Posting chunk ${chunkNumber} of ${totalChunks} (${chunk.length} headers)`,
      );

      try {
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
      } catch (error) {
        const errorDetails = this.dfoErrorExtractor.extractMessage(error);

        if (error?.response?.data) {
          this.logger.error(
            `D365FO error response: ${JSON.stringify(error.response.data)}`,
          );
        }

        this.logger.error(
          `Failed to post header chunk ${chunkNumber} of ${totalChunks}: ${errorDetails}`,
          error instanceof Error ? error.stack : undefined,
        );

        let errorMessage = `Failed to post headers in chunk ${chunkNumber}: ${errorDetails}`;
        if (headerIds.length > 0) {
          errorMessage += `. ${headerIds.length} headers were posted successfully before failure. Rollback required.`;
        }
        throw new Error(errorMessage);
      }
    }

    this.logger.debug(`Successfully posted ${headerIds.length} headers`);
    return headerIds;
  }

  /**
   * Post lines for a specific header. Sets ParentRecId on each line inside this service (request shaping).
   * Callers pass lines without ParentRecId; this method attaches the header key.
   */
  public async postLinesForHeader(
    headerKey: string,
    lines: D365FOFreeTextInvoiceLineRequest[],
    dataAreaId: string,
    chunkSize: number = 20,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const shapedLines = lines.map((line) => ({
      ...line,
      ParentRecId: parseInt(headerKey, 10),
    }));
    return this.postLinesBatch(shapedLines, chunkSize);
  }

  /**
   * Post multiple free text invoice lines in chunks
   * @param lines Array of line requests (must already have ParentRecId set)
   * @param chunkSize Number of lines to post per chunk (default: 20)
   * @returns Array of successfully posted line identifiers
   * @throws Error if any line fails - caller should rollback headers and successfully posted lines
   */
  public async postLinesBatch(
    lines: D365FOFreeTextInvoiceLineRequest[],
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
            headerId: String(line.ParentRecId),
            lineNumber: line.LineNumber,
          };
        });

        const chunkResults = await Promise.all(chunkPromises);
        successfullyPosted.push(...chunkResults);

        this.logger.debug(
          `Successfully posted chunk ${chunkNumber} (${chunk.length} lines)`,
        );
      } catch (error) {
        const errorDetails = this.dfoErrorExtractor.extractMessage(error);

        if (error?.response?.data) {
          this.logger.error(
            `D365FO error response: ${JSON.stringify(error.response.data)}`,
          );
        }

        this.logger.error(
          `Failed to post chunk ${chunkNumber} of ${totalChunks}: ${errorDetails}`,
          error instanceof Error ? error.stack : undefined,
        );

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
    const endpoint = `/data/FreeTextInvoiceHeaders(dataAreaId='${dataAreaId}',InvoiceIdentifier=${headerId})?cross-company=true`;
    const response = await this.d365foClient.delete(endpoint);

    // Verify deletion response (should be empty or 204)
    if (response !== undefined && response !== null) {
      this.logger.debug(`Header ${headerId} deleted successfully`);
    }
  }

  /**
   * Delete a free text invoice line (for rollback)
   * @param headerId The InvoiceIdentifier of the header
   * @param lineNumber The LineNumber of the line to delete
   * @param dataAreaId The company data area ID
   * @note Endpoint format is assumed and needs to be tested
   */
  public async deleteLine(
    headerId: string,
    lineNumber: number,
    dataAreaId: string,
  ): Promise<void> {
    this.logger.debug(
      `Deleting free text invoice line ${lineNumber} for invoice ${headerId} in company: ${dataAreaId}`,
    );

    // Assumed format based on vendor invoice journal pattern:
    // /data/FreeTextInvoiceLines(dataAreaId='m-p',InvoiceIdentifier=5637743016,LineNumber=1)?cross-company=true
    // This format needs to be verified through testing
    const endpoint = `/data/FreeTextInvoiceLines(dataAreaId='${dataAreaId}',ParentRecId=${headerId},LineNumber=${lineNumber})?cross-company=true`;
    const response = await this.d365foClient.delete(endpoint);

    // Verify deletion response (should be empty or 204)
    if (response !== undefined && response !== null) {
      this.logger.debug(
        `Line ${lineNumber} for invoice ${headerId} deleted successfully`,
      );
    }
  }

  /**
   * Delete multiple free text invoice lines in chunks
   * @param lines Array of line identifiers to delete
   * @param dataAreaId The company data area ID
   * @param chunkSize Number of lines to delete per chunk (default: 20)
   * @returns Array of results indicating success/failure for each line
   */
  public async deleteLinesBatch(
    lines: Array<{ headerId: string; lineNumber: number }>,
    dataAreaId: string,
    chunkSize: number = 20,
  ): Promise<
    Array<{
      headerId: string;
      lineNumber: number;
      success: boolean;
      error?: string;
    }>
  > {
    this.logger.debug(
      `Deleting ${lines.length} lines in chunks of ${chunkSize}`,
    );

    const results: Array<{
      headerId: string;
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
          await this.deleteLine(line.headerId, line.lineNumber, dataAreaId);
          return {
            headerId: line.headerId,
            lineNumber: line.lineNumber,
            success: true,
          };
        } catch (error) {
          const errorMessage = this.dfoErrorExtractor.extractMessage(error);
          this.logger.error(
            `Failed to delete line ${line.lineNumber} for invoice ${line.headerId}: ${errorMessage}`,
          );
          return {
            headerId: line.headerId,
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

  /**
   * Query and list all lines for a specific header from D365FO
   * @param headerKey The InvoiceIdentifier of the header (as string)
   * @param dataAreaId Company data area ID
   * @returns Array of line objects with LineNumber
   */
  public async listLinesForHeader(
    headerKey: string,
    dataAreaId: string,
  ): Promise<Array<{ LineNumber: number }>> {
    this.logger.debug(
      `[QUERY] Querying lines for invoice ${headerKey} in company ${dataAreaId}`,
    );

    const invoiceIdentifier = parseInt(headerKey, 10);
    if (isNaN(invoiceIdentifier)) {
      throw new Error(`Invalid invoice identifier: ${headerKey}`);
    }

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', dataAreaId),
      this.queryBuilder.eq('ParentRecId', invoiceIdentifier),
    );

    const query = this.queryBuilder.buildQuery('/data/FreeTextInvoiceLines', {
      filter,
      select: ['LineNumber'],
      crossCompany: true,
    });

    try {
      const response = await this.d365foClient.get<{ LineNumber: number }>(
        query,
        {
          useCache: false,
        },
      );

      const lines = response.value || [];
      this.logger.debug(
        `[QUERY] Found ${lines.length} lines for invoice ${headerKey}`,
      );

      return lines;
    } catch (error) {
      const errorDetails = this.dfoErrorExtractor.extractMessage(error);
      this.logger.error(
        `[QUERY] Failed to query lines for invoice ${headerKey}: ${errorDetails}`,
      );
      throw error;
    }
  }
}
