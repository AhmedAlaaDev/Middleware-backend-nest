import { Injectable, Logger } from '@nestjs/common';

import {
  DeleteLinesResult,
  IDfoPostingStrategy,
  PostHeadersResult,
} from './dfo-posting-strategy.interface';

import {
  createCustodySettlementSkipRow,
  CustodySettlementSkipRow,
} from '@/modules/cash/services/custody-settlement-skip-report';
import { dfoErrorMessage } from '@/modules/d365fo/errors/dfo-api.error';
import { CustomerPaymentJournalService } from '@/modules/d365fo/services/customer-payment-journal.service';
import { CustomerPaymentJournalSettlementService } from '@/modules/d365fo/services/customer-payment-journal-settlement.service';
import { VendorPaymentJournalService } from '@/modules/d365fo/services/vendor-payment-journal.service';
import {
  D365FOCustomerPaymentJournalHeaderRequest,
  D365FOCustomerPaymentJournalLineRequest,
  D365FOVendorPaymentJournalHeaderRequest,
} from '@/modules/d365fo/types';

/**
 * Strategy for cash payment journals:
 * - cash-in  → CustomerPaymentJournalHeaders / CustomerPaymentJournalLines
 * - cash-out → VendorPaymentJournalHeaders / VendorPaymentJournalLines
 *
 * Custom X++ line APIs are still invoked via CustomerPaymentJournalService.
 * Rollback/list/delete must use the same OData entity family as header create.
 */
@Injectable()
export class CustomerPaymentJournalPostingStrategy implements IDfoPostingStrategy {
  private readonly logger = new Logger(
    CustomerPaymentJournalPostingStrategy.name,
  );

  constructor(
    private readonly customerPaymentJournalService: CustomerPaymentJournalService,
    private readonly vendorPaymentJournalService: VendorPaymentJournalService,
    private readonly customerPaymentJournalSettlementService: CustomerPaymentJournalSettlementService,
  ) {}

  private headerCashDirectionContext: 'in' | 'out' = 'in';
  private skipReport: CustodySettlementSkipRow[] = [];

  public setHeaderCashDirectionContext(direction: 'in' | 'out'): void {
    this.headerCashDirectionContext = direction;
  }

  /** Skipped/partial customer settlements collected since the last call. */
  public consumeSkipReport(): CustodySettlementSkipRow[] {
    const rows = this.skipReport;
    this.skipReport = [];
    return rows;
  }

  private get isCashOut(): boolean {
    return this.headerCashDirectionContext === 'out';
  }

  public async postHeadersInBatches(
    headers: unknown[],
    chunkSize: number,
  ): Promise<PostHeadersResult> {
    const journalBatchNumbers = this.isCashOut
      ? await this.vendorPaymentJournalService.postHeadersBatch(
          headers as D365FOVendorPaymentJournalHeaderRequest[],
          chunkSize,
        )
      : await this.customerPaymentJournalService.postHeadersBatch(
          headers as D365FOCustomerPaymentJournalHeaderRequest[],
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
    if (typedLines.length === 0) {
      return [];
    }

    const cashDirection = typedLines[0].cashDirection;
    const dataAreaId = typedLines[0].dataAreaId;

    return cashDirection === 'out'
      ? this.customerPaymentJournalService.postCashOutLinesForHeader(
          '',
          typedLines,
          chunkSize,
          dataAreaId,
        )
      : this.customerPaymentJournalService.postCashInLinesForHeader(
          '',
          typedLines,
          chunkSize,
          dataAreaId,
        );
  }

  public async postLinesForHeader(
    headerKey: string,
    lines: unknown[],
    dataAreaId: string,
    chunkSize: number = 20,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const typedLines = lines as D365FOCustomerPaymentJournalLineRequest[];
    const cashDirection = typedLines[0]?.cashDirection ?? 'in';

    const postedLines =
      cashDirection === 'out'
        ? await this.customerPaymentJournalService.postCashOutLinesForHeader(
            headerKey,
            typedLines,
            chunkSize,
            dataAreaId,
          )
        : await this.customerPaymentJournalService.postCashInLinesForHeader(
            headerKey,
            typedLines,
            chunkSize,
            dataAreaId,
          );

    if (cashDirection === 'in') {
      await this.settleCustomerPaymentLines(
        headerKey,
        dataAreaId,
        typedLines,
      );
    }

    return postedLines;
  }

  private async settleCustomerPaymentLines(
    journalBatchNumber: string,
    company: string,
    lines: D365FOCustomerPaymentJournalLineRequest[],
  ): Promise<void> {
    const targets = lines.flatMap((line) => {
      const invoiceNumber = String(
        line.customerSettlement?.invoiceNumber ?? '',
      ).trim();
      const customerAccount = String(
        line.customerSettlement?.customerAccount ??
          line.customLineApiBody?.AccountNum ??
          '',
      ).trim();
      const settlementAmount = Number(
        line.customerSettlement?.settlementAmount ?? 0,
      );
      const transDate = String(
        line.customLineApiBody?.transDate ??
          (line.customLineApiBody as { TransDate?: string } | undefined)
            ?.TransDate ??
          '',
      ).trim();
      const currencyCode = String(
        line.customLineApiBody?.currency ?? '',
      ).trim();
      const paymentExchangeRate = Number(
        line.customLineApiBody?.ExchangeRate ??
          line.customLineApiBody?.EXCHANGERATE ??
          line.customLineApiBody?.ExchRate ??
          0,
      );
      if (
        !invoiceNumber ||
        !customerAccount ||
        !(settlementAmount > 0) ||
        !(line.LineNumber > 0)
      ) {
        return [];
      }
      return [
        {
          lineNumber: line.LineNumber,
          invoiceNumber,
          settlementAmount,
          customerAccount,
          ...(transDate ? { transDate } : {}),
          ...(currencyCode ? { currencyCode } : {}),
          ...(paymentExchangeRate > 0 ? { paymentExchangeRate } : {}),
        },
      ];
    });
    if (targets.length === 0) return;

    const skips =
      await this.customerPaymentJournalSettlementService.createSettlements({
        company,
        journalBatchNumber,
        targets,
      });

    if (skips.length === 0) return;
    const linesByNumber = new Map(
      lines.map((line) => [Number(line.LineNumber), line]),
    );
    this.skipReport.push(
      ...skips.map((skip) => {
        const line = linesByNumber.get(skip.lineNumber);
        return createCustodySettlementSkipRow({
          uniqueId: String(line?.customLineApiBody?.PAYMENTID ?? '').trim(),
          excelLineNumbers: [line?.sourceLineNumber],
          journalBatchNumber,
          d365LineNumbers: [skip.lineNumber],
          vendorAccount: skip.customerAccount,
          invoiceNumber: skip.invoiceNumber,
          amount: skip.requestedAmount,
          phase: 'settle',
          error: skip.reason,
        });
      }),
    );
    this.logger.warn(
      `Customer settlement skipped or partial on ${skips.length} line(s) of journal ${journalBatchNumber}; lines remain posted (cash on account).`,
    );
  }

  public async deleteHeader(
    headerId: string,
    dataAreaId: string,
  ): Promise<void> {
    if (this.isCashOut) {
      await this.vendorPaymentJournalService.deleteHeader(headerId, dataAreaId);
      return;
    }
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
    const entityLabel = this.isCashOut ? 'vendor payment' : 'customer payment';

    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(lines.length / chunkSize);

      this.logger.debug(
        `[DELETE] Deleting ${entityLabel} lines chunk ${chunkNumber} of ${totalChunks} (${chunk.length} lines)`,
      );

      const deletePromises = chunk.map(async (line) => {
        try {
          if (this.isCashOut) {
            await this.vendorPaymentJournalService.deleteLine(
              line.headerId,
              line.lineNumber,
              dataAreaId,
            );
          } else {
            await this.customerPaymentJournalService.deleteLine(
              line.headerId,
              line.lineNumber,
              dataAreaId,
            );
          }
          result.successful.push(line);
        } catch (error) {
          const errorMessage = dfoErrorMessage(error);
          this.logger.error(
            `[DELETE] Failed to delete ${entityLabel} line ${line.lineNumber} for journal ${line.headerId}: ${errorMessage}`,
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
    if (this.isCashOut) {
      return this.vendorPaymentJournalService.listLinesForHeader(
        headerKey,
        dataAreaId,
      );
    }
    return this.customerPaymentJournalService.listLinesForHeader(
      headerKey,
      dataAreaId,
    );
  }
}
