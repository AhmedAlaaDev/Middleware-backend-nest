import { Injectable } from '@nestjs/common';

import {
  DeleteLinesResult,
  IDfoPostingStrategy,
  PostHeadersResult,
} from './dfo-posting-strategy.interface';

import {
  CashJournalRoute,
  CashJournalRoutingService,
} from '@/modules/cash/services/cash-journal-routing.service';
import { normalizeCashCompositeDisplayValue } from '@/modules/cash/policies/cash-dimension.policy';
import { CustomerPaymentJournalService } from '@/modules/d365fo/services/customer-payment-journal.service';
import { D365FOCustomerPaymentJournalLineRequest } from '@/modules/d365fo/types';
import { CustomerPaymentJournalPostingStrategy } from '@/modules/queue/strategies/customer-payment-journal-posting.strategy';
import { LedgerJournalPostingStrategy } from '@/modules/queue/strategies/ledger-journal-posting.strategy';
import { VendorPaymentJournalPostingStrategy } from '@/modules/queue/strategies/vendor-payment-journal-posting.strategy';

/**
 * Task 2045 cash strategy.
 *
 * Header/list/delete operations use the entity family selected by Safe Type.
 * Lines continue through the custom cash X++ APIs so the complete cash payload
 * (including FinTags and RCash) and the task-2031 invoice fallback are retained.
 */
@Injectable()
export class CashJournalPostingStrategy implements IDfoPostingStrategy {
  private route?: CashJournalRoute;
  private readonly routingService = new CashJournalRoutingService();

  constructor(
    private readonly customerPaymentJournalService: CustomerPaymentJournalService,
    private readonly customerPaymentStrategy: CustomerPaymentJournalPostingStrategy,
    private readonly vendorPaymentStrategy: VendorPaymentJournalPostingStrategy,
    private readonly ledgerStrategy: LedgerJournalPostingStrategy,
  ) {}

  public setRouteContext(route: CashJournalRoute): void {
    this.assertRouteIntegrity(route);
    this.route = route;
    if (route.kind === 'customer-payment') {
      this.customerPaymentStrategy.setHeaderCashDirectionContext('in');
    }
  }

  public async postHeadersInBatches(
    headers: unknown[],
    chunkSize: number,
  ): Promise<PostHeadersResult> {
    const result = await this.activeHeaderStrategy().postHeadersInBatches(
      headers,
      chunkSize,
    );
    const validHeaderIds = result.headerIds.filter(
      (headerId) => typeof headerId === 'string' && headerId.trim().length > 0,
    );
    if (validHeaderIds.length !== headers.length) {
      throw new Error(
        `D365FO returned ${validHeaderIds.length} valid cash journal number(s) for ${headers.length} header(s)`,
      );
    }
    return result;
  }

  public postLinesInBatches(
    _lines: unknown[],
    _chunkSize: number,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    throw new Error(
      'postLinesInBatches is not used for routed cash journals; use postLinesForHeader',
    );
  }

  public postLinesForHeader(
    headerKey: string,
    lines: unknown[],
    dataAreaId: string,
    chunkSize: number = 20,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const route = this.requireRoute();
    const typedLines = lines as D365FOCustomerPaymentJournalLineRequest[];
    const postingLines = this.prepareCashPostingLines(route, typedLines);
    const existingLinesLoader = () =>
      this.activeHeaderStrategy().listLinesForHeader(headerKey, dataAreaId);

    return route.lineDirection === 'in'
      ? this.customerPaymentJournalService.postCashInLinesForHeader(
          headerKey,
          postingLines,
          chunkSize,
          dataAreaId,
          existingLinesLoader,
          // This is an outbound Cash-Out transaction even though AR routes
          // use the customer-payment custom API. Preserve task-2031 fallback.
          true,
        )
      : this.customerPaymentJournalService.postCashOutLinesForHeader(
          headerKey,
          postingLines,
          chunkSize,
          dataAreaId,
          existingLinesLoader,
        );
  }

  public deleteHeader(headerId: string, dataAreaId: string): Promise<void> {
    return this.activeHeaderStrategy().deleteHeader(headerId, dataAreaId);
  }

  public deleteLinesInBatches(
    lines: Array<{ headerId: string; lineNumber: number }>,
    dataAreaId: string,
    chunkSize: number,
  ): Promise<DeleteLinesResult> {
    return this.activeHeaderStrategy().deleteLinesInBatches(
      lines,
      dataAreaId,
      chunkSize,
    );
  }

  public extractHeaderIdFromResponse(response: unknown): string {
    const journalBatchNumber = (response as { JournalBatchNumber?: string })
      ?.JournalBatchNumber;
    if (!journalBatchNumber) {
      throw new Error('JournalBatchNumber not found in response');
    }
    return journalBatchNumber;
  }

  public listLinesForHeader(
    headerKey: string,
    dataAreaId: string,
  ): Promise<Array<{ LineNumber: number }>> {
    return this.activeHeaderStrategy().listLinesForHeader(
      headerKey,
      dataAreaId,
    );
  }

  private activeHeaderStrategy(): IDfoPostingStrategy {
    const route = this.requireRoute();
    switch (route.kind) {
      case 'vendor-invoice':
        return this.vendorPaymentStrategy;
      case 'ledger':
        return this.ledgerStrategy;
      case 'customer-payment':
        return this.customerPaymentStrategy;
    }
  }

  /**
   * A Custody Settlement credit reverses a prior custody issue transaction.
   * That D365 vendor transaction has no invoice value, so it is selected by
   * vendor + document + operation + amount. Keep the MarkedLines entry, but
   * never copy a supplier receipt invoice onto the custody-holder account.
   */
  private prepareCashPostingLines(
    route: CashJournalRoute,
    lines: D365FOCustomerPaymentJournalLineRequest[],
  ): D365FOCustomerPaymentJournalLineRequest[] {
    return lines.map((line) => {
      const body = {
        ...line.customLineApiBody,
        ...(line.customLineApiBody.AccountNum !== undefined
          ? {
              AccountNum: normalizeCashCompositeDisplayValue(
                line.customLineApiBody.AccountNum,
              ),
            }
          : {}),
        ...(line.customLineApiBody.DEFAULTDIMENSIONDISPLAYVALUE !== undefined
          ? {
              DEFAULTDIMENSIONDISPLAYVALUE:
                normalizeCashCompositeDisplayValue(
                  line.customLineApiBody.DEFAULTDIMENSIONDISPLAYVALUE,
                ),
            }
          : {}),
        ...(line.customLineApiBody.offsetAccountDisplayValue !== undefined
          ? {
              offsetAccountDisplayValue: normalizeCashCompositeDisplayValue(
                line.customLineApiBody.offsetAccountDisplayValue,
              ),
            }
          : {}),
        ...(line.customLineApiBody.offsetDEFAULTDIMENSIONDISPLAYVALUE !==
        undefined
          ? {
              offsetDEFAULTDIMENSIONDISPLAYVALUE:
                normalizeCashCompositeDisplayValue(
                  line.customLineApiBody.offsetDEFAULTDIMENSIONDISPLAYVALUE,
                ),
            }
          : {}),
      };
      const normalizedLine = { ...line, customLineApiBody: body };
      if (route.safeType !== 'Custody Settlement') return normalizedLine;

      const isCustodyCredit =
        String(body.accountTypeStr ?? '').trim().toLowerCase() === 'vendor' &&
        Number(body.creditAmount ?? 0) > 0;
      if (!isCustodyCredit) return normalizedLine;

      const sourceMark = body.MarkedLines?.[0];
      const operationNumber =
        String(sourceMark?.OperationNumber ?? '').trim() ||
        String(body.FinTagStr ?? '')
          .split('|')[0]
          .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
          .trim();
      const documentNumber =
        String(sourceMark?.DocumentNumber ?? '').trim() ||
        String(body.DocumentNum ?? '').trim();

      if (!documentNumber) {
        throw new Error(
          `Custody Settlement vendor credit line ${line.LineNumber ?? '?'} cannot be posted without DocumentNumber in MarkedLines`,
        );
      }

      return {
        ...normalizedLine,
        customLineApiBody: {
          ...body,
          MarkedLines: [
            {
              InvoiceNumber: '',
              OperationNumber: operationNumber,
              DocumentNumber: documentNumber,
              HasWithHoldingLine: Boolean(sourceMark?.HasWithHoldingLine),
            },
          ],
        },
      };
    });
  }

  private requireRoute(): CashJournalRoute {
    if (!this.route) {
      throw new Error('Cash journal route context has not been set');
    }
    return this.route;
  }

  private assertRouteIntegrity(route: CashJournalRoute): void {
    let expected: CashJournalRoute;
    try {
      expected = this.routingService.resolve({
        safeType: route.safeType,
        targetProcessor: route.targetProcessor,
      });
    } catch (error) {
      throw new Error(
        `Invalid cash journal route: ${error instanceof Error ? error.message : 'unknown routing error'}`,
      );
    }

    const fields: Array<keyof CashJournalRoute> = [
      'kind',
      'module',
      'safeType',
      'targetProcessor',
      'journalName',
      'headerApi',
      'lineDirection',
    ];
    const mismatched = fields.filter(
      (field) => route[field] !== expected[field],
    );
    if (mismatched.length) {
      throw new Error(
        `Invalid cash journal route for ${route.safeType}: mismatched ${mismatched.join(', ')}`,
      );
    }
  }
}
