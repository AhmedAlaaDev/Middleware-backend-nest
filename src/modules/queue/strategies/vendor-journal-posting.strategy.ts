import { Injectable, Logger } from '@nestjs/common';

import {
  DeleteLinesResult,
  IDfoPostingStrategy,
  PostHeadersResult,
} from './dfo-posting-strategy.interface';

import { VendorInvoiceJournalService } from '@/modules/d365fo/services/vendor-invoice-journal.service';
import {
  D365FOVendorInvoiceJournalHeaderRequest,
  D365FOVendorInvoiceJournalLineRequest,
} from '@/modules/d365fo/types';

/**
 * Strategy implementation for posting vendor invoice journals to D365FO
 */
@Injectable()
export class VendorJournalPostingStrategy implements IDfoPostingStrategy {
  private readonly logger = new Logger(VendorJournalPostingStrategy.name);

  constructor(
    private readonly vendorInvoiceJournalService: VendorInvoiceJournalService,
  ) {}

  public async postHeadersInBatches(
    headers: unknown[],
    chunkSize: number,
  ): Promise<PostHeadersResult> {
    const typedHeaders = headers as D365FOVendorInvoiceJournalHeaderRequest[];
    const journalBatchNumbers =
      await this.vendorInvoiceJournalService.postHeadersBatch(
        typedHeaders,
        chunkSize,
      );

    const responses = journalBatchNumbers.map((batchNumber) => ({
      JournalBatchNumber: batchNumber,
    }));

    return {
      headerIds: journalBatchNumbers,
      responses,
    };
  }

  public async postLinesInBatches(
    lines: unknown[],
    chunkSize: number,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const typedLines = lines as D365FOVendorInvoiceJournalLineRequest[];
    return await this.vendorInvoiceJournalService.postLinesBatch(
      typedLines,
      chunkSize,
    );
  }

  public async deleteHeader(
    headerId: string,
    dataAreaId: string,
  ): Promise<void> {
    await this.vendorInvoiceJournalService.deleteHeader(headerId, dataAreaId);
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
          await this.vendorInvoiceJournalService.deleteLine(
            line.headerId,
            line.lineNumber,
            dataAreaId,
          );
          result.successful.push(line);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to delete line ${line.lineNumber} for journal ${line.headerId}: ${errorMessage}`,
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
    const typedResponse = response as { JournalBatchNumber?: string };
    if (!typedResponse?.JournalBatchNumber) {
      throw new Error('JournalBatchNumber not found in response');
    }
    return typedResponse.JournalBatchNumber;
  }

  public prepareLinesForPosting(
    lines: unknown[],
    headerIds: string[],
    groupedData: unknown[],
  ): unknown[] {
    const typedGroupedData = groupedData as Array<{
      header: D365FOVendorInvoiceJournalHeaderRequest;
      lines: D365FOVendorInvoiceJournalLineRequest[];
    }>;

    const allLines: D365FOVendorInvoiceJournalLineRequest[] = [];

    for (let i = 0; i < typedGroupedData.length; i++) {
      const journal = typedGroupedData[i];
      const journalBatchNumber = headerIds[i];

      // Remove FullPrimaryRemittanceAddress from each line before posting
      const cleanedLines = journal.lines.map((line) => {
        const { FullPrimaryRemittanceAddress, ...cleanedLine } = line as any;
        return {
          ...cleanedLine,
          JournalBatchNumber: journalBatchNumber,
        } as D365FOVendorInvoiceJournalLineRequest;
      });

      allLines.push(...cleanedLines);
    }

    return allLines;
  }
}
