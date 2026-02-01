import { Injectable, Logger } from '@nestjs/common';

import {
  DeleteLinesResult,
  IDfoPostingStrategy,
  PostHeadersResult,
} from './dfo-posting-strategy.interface';

import { GeneralJournalService } from '@/modules/d365fo/services/general-journal.service';
import {
  LedgerJournalHeaderRequest,
  LedgerJournalHeaderResponse,
  LedgerJournalLineRequest,
} from '@/modules/d365fo/types/d365fo-ledger.type';

/**
 * Strategy implementation for posting ledger journal headers and lines to D365FO.
 * Uses JournalBatchNumber from the header POST response when posting lines.
 */
@Injectable()
export class LedgerJournalPostingStrategy implements IDfoPostingStrategy {
  private readonly logger = new Logger(LedgerJournalPostingStrategy.name);

  constructor(private readonly generalJournalService: GeneralJournalService) {}

  public async postHeadersInBatches(
    headers: unknown[],
    chunkSize: number,
  ): Promise<PostHeadersResult> {
    const typedHeaders = headers as LedgerJournalHeaderRequest[];
    const headerIds: string[] = [];
    const responses: LedgerJournalHeaderResponse[] = [];

    for (let i = 0; i < typedHeaders.length; i += chunkSize) {
      const chunk = typedHeaders.slice(i, i + chunkSize);
      const company =
        chunk[0]?.dataAreaId ?? (typedHeaders[0]?.dataAreaId as string);

      for (const header of chunk) {
        const response = await this.generalJournalService.createJournalHeader(
          company,
          header,
        );
        responses.push(response);
        headerIds.push(response.JournalBatchNumber);
      }
    }

    return {
      headerIds,
      responses,
    };
  }

  public postLinesInBatches(
    _lines: unknown[],
    _chunkSize: number,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    throw new Error(
      'postLinesInBatches not used for ledger journal; use postLinesForHeader',
    );
  }

  public async postLinesForHeader(
    headerKey: string,
    lines: unknown[],
    dataAreaId: string,
    chunkSize: number = 20,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const typedLines = lines as LedgerJournalLineRequest[];
    const result: Array<{ headerId: string; lineNumber: number }> = [];

    for (let i = 0; i < typedLines.length; i += chunkSize) {
      const chunk = typedLines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(typedLines.length / chunkSize);

      this.logger.debug(
        `Posting ledger journal lines chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
      );

      const postPromises = chunk.map(async (line) => {
        const payload: LedgerJournalLineRequest = {
          ...line,
          dataAreaId,
          JournalBatchNumber: headerKey,
        };
        const response = await this.generalJournalService.createJournalLine(
          dataAreaId,
          payload,
        );
        return {
          headerId: headerKey,
          lineNumber: response.LineNumber ?? 0,
        };
      });

      const chunkResults = await Promise.all(postPromises);
      result.push(...chunkResults);
    }

    return result;
  }

  public async deleteHeader(
    headerId: string,
    dataAreaId: string,
  ): Promise<void> {
    await this.generalJournalService.deleteJournalHeader(dataAreaId, headerId);
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
        `[DELETE] Deleting ledger journal lines chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
      );

      const deletePromises = chunk.map(async (line) => {
        try {
          await this.generalJournalService.deleteJournalLine(
            dataAreaId,
            line.headerId,
            line.lineNumber,
          );
          result.successful.push(line);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `[DELETE] Failed to delete line ${line.lineNumber} for batch ${line.headerId}: ${errorMessage}`,
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
    const typed = response as LedgerJournalHeaderResponse;
    if (!typed?.JournalBatchNumber) {
      throw new Error('JournalBatchNumber not found in header response');
    }
    return typed.JournalBatchNumber;
  }

  public async listLinesForHeader(
    headerKey: string,
    dataAreaId: string,
  ): Promise<Array<{ LineNumber: number }>> {
    const lines = await this.generalJournalService.getJournalLines(
      dataAreaId,
      headerKey,
      { select: ['LineNumber'] },
    );
    return (lines as Array<{ LineNumber?: number }>).map((l) => ({
      LineNumber: l.LineNumber ?? 0,
    }));
  }
}
