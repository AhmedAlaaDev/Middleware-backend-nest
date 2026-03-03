import { Injectable, Logger } from '@nestjs/common';

import {
  DeleteLinesResult,
  IDfoPostingStrategy,
  PostHeadersResult,
} from './dfo-posting-strategy.interface';

import { CustomerPaymentJournalService } from '@/modules/d365fo/services/customer-payment-journal.service';
import { DfoErrorExtractorService } from '@/modules/d365fo/services/dfo-error-extractor.service';
import {
  D365FOCustomerPaymentJournalHeaderRequest,
  D365FOCustomerPaymentJournalLineRequest,
} from '@/modules/d365fo/types';

/**
 * Strategy implementation for posting customer payment journals to D365FO
 * (CustomerPaymentJournalHeaders / CustomerPaymentJournalLines)
 */
@Injectable()
export class CustomerPaymentJournalPostingStrategy implements IDfoPostingStrategy {
  private readonly logger = new Logger(
    CustomerPaymentJournalPostingStrategy.name,
  );

  constructor(
    private readonly customerPaymentJournalService: CustomerPaymentJournalService,
    private readonly dfoErrorExtractor: DfoErrorExtractorService,
  ) {}

  public async postHeadersInBatches(
    headers: unknown[],
    chunkSize: number,
  ): Promise<PostHeadersResult> {
    const typedHeaders = headers as D365FOCustomerPaymentJournalHeaderRequest[];
    const journalBatchNumbers =
      await this.customerPaymentJournalService.postHeadersBatch(
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
    const typedLines = lines as D365FOCustomerPaymentJournalLineRequest[];
    const headerKey = typedLines[0]?.JournalBatchNumber;
    if (!headerKey || typedLines.length === 0) {
      return [];
    }
    return this.customerPaymentJournalService.postLinesForHeader(
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
    const typedLines = lines as D365FOCustomerPaymentJournalLineRequest[];
    return this.customerPaymentJournalService.postLinesForHeader(
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
    await this.customerPaymentJournalService.deleteHeader(headerId, dataAreaId);
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
        `[DELETE] Deleting customer payment lines chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
      );

      const deletePromises = chunk.map(async (line) => {
        try {
          await this.customerPaymentJournalService.deleteLine(
            line.headerId,
            line.lineNumber,
            dataAreaId,
          );
          result.successful.push(line);
        } catch (error) {
          const errorMessage = this.dfoErrorExtractor.extractMessage(error);
          this.logger.error(
            `[DELETE] Failed to delete customer payment line ${line.lineNumber} for journal ${line.headerId}: ${errorMessage}`,
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
    return await this.customerPaymentJournalService.listLinesForHeader(
      headerKey,
      dataAreaId,
    );
  }
}

