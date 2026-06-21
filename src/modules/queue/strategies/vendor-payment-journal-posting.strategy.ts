import { Injectable, Logger } from '@nestjs/common';

import {
  DeleteLinesResult,
  IDfoPostingStrategy,
  PostHeadersResult,
} from './dfo-posting-strategy.interface';

import { dfoErrorMessage } from '@/modules/d365fo/errors/dfo-api.error';
import { VendorPaymentJournalService } from '@/modules/d365fo/services/vendor-payment-journal.service';
import {
  D365FOVendorPaymentJournalHeaderRequest,
  D365FOVendorPaymentJournalLineRequest,
} from '@/modules/d365fo/types';

/**
 * Strategy implementation for posting vendor payment journals to D365FO
 * (VendorPaymentJournalHeaders / VendorPaymentJournalLines)
 */
@Injectable()
export class VendorPaymentJournalPostingStrategy implements IDfoPostingStrategy {
  private readonly logger = new Logger(
    VendorPaymentJournalPostingStrategy.name,
  );

  constructor(
    private readonly vendorPaymentJournalService: VendorPaymentJournalService,
  ) {}

  public async postHeadersInBatches(
    headers: unknown[],
    chunkSize: number,
  ): Promise<PostHeadersResult> {
    const typedHeaders = headers as D365FOVendorPaymentJournalHeaderRequest[];
    const journalBatchNumbers =
      await this.vendorPaymentJournalService.postHeadersBatch(
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
    const typedLines = lines as D365FOVendorPaymentJournalLineRequest[];
    const headerKey = typedLines[0]?.JournalBatchNumber;
    if (!headerKey || typedLines.length === 0) {
      return [];
    }
    return this.vendorPaymentJournalService.postLinesForHeader(
      headerKey,
      typedLines,
      chunkSize,
      typedLines[0].dataAreaId,
    );
  }

  public async postLinesForHeader(
    headerKey: string,
    lines: unknown[],
    dataAreaId: string,
    chunkSize: number = 20,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const typedLines = lines as D365FOVendorPaymentJournalLineRequest[];
    return this.vendorPaymentJournalService.postLinesForHeader(
      headerKey,
      typedLines,
      chunkSize,
      dataAreaId,
    );
  }

  public async deleteHeader(
    headerId: string,
    dataAreaId: string,
  ): Promise<void> {
    await this.vendorPaymentJournalService.deleteHeader(headerId, dataAreaId);
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

    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.debug(
        `[DELETE] Deleting payment lines chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
      );

      const deletePromises = chunk.map(async (line) => {
        try {
          await this.vendorPaymentJournalService.deleteLine(
            line.headerId,
            line.lineNumber,
            dataAreaId,
          );
          result.successful.push(line);
        } catch (error) {
          const errorMessage = dfoErrorMessage(error);
          this.logger.error(
            `[DELETE] Failed to delete payment line ${line.lineNumber} for journal ${line.headerId}: ${errorMessage}`,
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

  public async listLinesForHeader(
    headerKey: string,
    dataAreaId: string,
  ): Promise<Array<{ LineNumber: number }>> {
    return await this.vendorPaymentJournalService.listLinesForHeader(
      headerKey,
      dataAreaId,
    );
  }
}
