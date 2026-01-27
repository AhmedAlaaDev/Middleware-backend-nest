import { Injectable, Logger } from '@nestjs/common';

import {
  DeleteLinesResult,
  IDfoPostingStrategy,
  PostHeadersResult,
} from './dfo-posting-strategy.interface';

import { DfoErrorExtractorService } from '@/modules/d365fo/services/dfo-error-extractor.service';
import { FreeTextInvoiceService } from '@/modules/d365fo/services/free-text-invoice.service';
import {
  D365FOFreeTextInvoiceHeaderRequest,
  D365FOFreeTextInvoiceLineRequest,
} from '@/modules/d365fo/types';

/**
 * Strategy implementation for posting free text invoices to D365FO
 */
@Injectable()
export class FreeTextInvoicePostingStrategy implements IDfoPostingStrategy {
  private readonly logger = new Logger(FreeTextInvoicePostingStrategy.name);

  constructor(
    private readonly freeTextInvoiceService: FreeTextInvoiceService,
    private readonly dfoErrorExtractor: DfoErrorExtractorService,
  ) {}

  public async postHeadersInBatches(
    headers: unknown[],
    chunkSize: number,
  ): Promise<PostHeadersResult> {
    const typedHeaders = headers as D365FOFreeTextInvoiceHeaderRequest[];
    const headerIds = await this.freeTextInvoiceService.postHeadersBatch(
      typedHeaders,
      chunkSize,
    );

    const responses = headerIds.map((id) => ({
      InvoiceIdentifier: parseInt(id, 10),
    }));

    return {
      headerIds,
      responses,
    };
  }

  public async postLinesInBatches(
    lines: unknown[],
    chunkSize: number,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const typedLines = lines as D365FOFreeTextInvoiceLineRequest[];
    return await this.freeTextInvoiceService.postLinesBatch(
      typedLines,
      chunkSize,
    );
  }

  public async postLinesForHeader(
    headerKey: string,
    lines: unknown[],
    dataAreaId: string,
    chunkSize: number = 20,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const typedLines = lines as D365FOFreeTextInvoiceLineRequest[];
    return this.freeTextInvoiceService.postLinesForHeader(
      headerKey,
      typedLines,
      dataAreaId,
      chunkSize,
    );
  }

  public async deleteHeader(
    headerId: string,
    dataAreaId: string,
  ): Promise<void> {
    await this.freeTextInvoiceService.deleteHeader(headerId, dataAreaId);
  }

  public async deleteLinesInBatches(
    lines: Array<{ headerId: string; lineNumber: number }>,
    dataAreaId: string,
    chunkSize: number,
  ): Promise<DeleteLinesResult> {
    const result: DeleteLinesResult = {
      successful: [],
      failed: [],
    };

    // Process in chunks
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.debug(
        `[DELETE] Deleting lines chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
      );

      // Delete lines in parallel within chunk
      const deletePromises = chunk.map(async (line) => {
        try {
          await this.freeTextInvoiceService.deleteLine(
            line.headerId,
            line.lineNumber,
            dataAreaId,
          );
          result.successful.push(line);
        } catch (error) {
          const errorMessage = this.dfoErrorExtractor.extractMessage(error);
          this.logger.error(
            `[DELETE] Failed to delete line ${line.lineNumber} for invoice ${line.headerId}: ${errorMessage}`,
          );
          result.failed.push({
            ...line,
            error: errorMessage,
          });
        }
      });

      await Promise.all(deletePromises);
    }

    return result;
  }

  public extractHeaderIdFromResponse(response: unknown): string {
    const typedResponse = response as { InvoiceIdentifier?: number | string };
    if (
      typedResponse?.InvoiceIdentifier === undefined ||
      typedResponse?.InvoiceIdentifier === null
    ) {
      throw new Error('InvoiceIdentifier not found in response');
    }
    return String(typedResponse.InvoiceIdentifier);
  }

  public async listLinesForHeader(
    headerKey: string,
    dataAreaId: string,
  ): Promise<Array<{ LineNumber: number }>> {
    return await this.freeTextInvoiceService.listLinesForHeader(
      headerKey,
      dataAreaId,
    );
  }
}
