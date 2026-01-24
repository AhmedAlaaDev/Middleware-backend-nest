import { Injectable, Logger } from '@nestjs/common';

import {
  DeleteLinesResult,
  IDfoPostingStrategy,
  PostHeadersResult,
} from './dfo-posting-strategy.interface';

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
        `Deleting lines chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
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
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to delete line ${line.lineNumber} for invoice ${line.headerId}: ${errorMessage}`,
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

  public prepareLinesForPosting(
    lines: unknown[],
    headerIds: string[],
    groupedData: unknown[],
  ): unknown[] {
    const typedGroupedData = groupedData as Array<{
      header: D365FOFreeTextInvoiceHeaderRequest;
      lines: D365FOFreeTextInvoiceLineRequest[];
    }>;

    const allLines: D365FOFreeTextInvoiceLineRequest[] = [];

    for (let i = 0; i < typedGroupedData.length; i++) {
      const invoice = typedGroupedData[i];
      const headerId = headerIds[i];

      // Update ParentRecId for all lines in this invoice
      const linesWithParentId = invoice.lines.map((line) => ({
        ...line,
        ParentRecId: parseInt(headerId, 10),
      }));

      allLines.push(...linesWithParentId);
    }

    return allLines;
  }
}
