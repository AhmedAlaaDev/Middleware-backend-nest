import { Injectable } from '@nestjs/common';

import {
  DeleteLinesResult,
  IDfoPostingStrategy,
  PostHeadersResult,
} from './dfo-posting-strategy.interface';

import { normalizeCashCompositeDisplayValue } from '@/modules/cash/policies/cash-dimension.policy';
import {
  CashJournalRoute,
  CashJournalRoutingService,
} from '@/modules/cash/services/cash-journal-routing.service';
import {
  createCustodySettlementSkipRow,
  CustodySettlementSkipRow,
} from '@/modules/cash/services/custody-settlement-skip-report';
import { CustomerPaymentJournalService } from '@/modules/d365fo/services/customer-payment-journal.service';
import {
  VendorInvoiceJournalService,
  VendorPaymentJournalSettlementTarget,
} from '@/modules/d365fo/services/vendor-invoice-journal.service';
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
  private skipReport: CustodySettlementSkipRow[] = [];

  constructor(
    private readonly customerPaymentJournalService: CustomerPaymentJournalService,
    private readonly vendorInvoiceJournalService: VendorInvoiceJournalService,
    private readonly customerPaymentStrategy: CustomerPaymentJournalPostingStrategy,
    private readonly vendorPaymentStrategy: VendorPaymentJournalPostingStrategy,
    private readonly ledgerStrategy: LedgerJournalPostingStrategy,
  ) {}

  public setRouteContext(route: CashJournalRoute): void {
    this.assertRouteIntegrity(route);
    this.route = route;
    this.skipReport = [];
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

  public consumeSkipReport(): CustodySettlementSkipRow[] {
    const rows = this.skipReport;
    this.skipReport = [];
    return rows;
  }

  public async postLinesForHeader(
    headerKey: string,
    lines: unknown[],
    dataAreaId: string,
    chunkSize: number = 20,
  ): Promise<Array<{ headerId: string; lineNumber: number }>> {
    const route = this.requireRoute();
    const typedLines = lines as D365FOCustomerPaymentJournalLineRequest[];
    const skipFailedUniqueIds = route.safeType === 'Custody Settlement';
    const { postingLines, deferredSettlements, skipped } =
      this.prepareCashPostingLines(route, typedLines, skipFailedUniqueIds);
    this.skipReport.push(...skipped);
    const existingLinesLoader = () =>
      this.activeHeaderStrategy().listLinesForHeader(headerKey, dataAreaId);

    let postedLines: Array<{ headerId: string; lineNumber: number }>;
    if (route.lineDirection === 'in') {
      postedLines =
        await this.customerPaymentJournalService.postCashInLinesForHeader(
          headerKey,
          postingLines,
          chunkSize,
          dataAreaId,
          existingLinesLoader,
          // This is an outbound Cash-Out transaction even though AR routes
          // use the customer-payment custom API. Preserve task-2031 fallback.
          true,
        );
    } else if (skipFailedUniqueIds) {
      const posted = await this.customerPaymentJournalService.postCashOutLinesForHeaderAllowingSkips(
        headerKey,
        postingLines,
        chunkSize,
        dataAreaId,
        existingLinesLoader,
      );
      postedLines = posted.postedLines;
      this.skipReport.push(...posted.skipped);
    } else {
      postedLines =
        await this.customerPaymentJournalService.postCashOutLinesForHeader(
          headerKey,
          postingLines,
          chunkSize,
          dataAreaId,
          existingLinesLoader,
        );
    }

    const skippedUniqueIds = new Set(
      this.skipReport
        .map((row) => row.uniqueId)
        .filter((uniqueId) => uniqueId.length > 0),
    );
    const settleTargets = deferredSettlements.filter(
      (target) => !target.uniqueId || !skippedUniqueIds.has(target.uniqueId),
    );

    if (settleTargets.length > 0) {
      // The custom line request must complete first because the OData entity
      // references the newly-created journal batch and line number.
      await this.vendorInvoiceJournalService.createVendorPaymentJournalLineSettlements(
        {
          company: dataAreaId,
          journalBatchNumber: headerKey,
          targets: settleTargets,
          continueOnError: skipFailedUniqueIds,
          skipped: skipFailedUniqueIds ? this.skipReport : undefined,
        },
      );
    }

    return postedLines;
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
    skipFailedUniqueIds = false,
  ): {
    postingLines: D365FOCustomerPaymentJournalLineRequest[];
    deferredSettlements: VendorPaymentJournalSettlementTarget[];
    skipped: CustodySettlementSkipRow[];
  } {
    const deferredSettlements: VendorPaymentJournalSettlementTarget[] = [];
    const skipped: CustodySettlementSkipRow[] = [];
    const skippedUniqueIds = new Set<string>();
    const skippedLineNumbers = new Set<number>();

    const skipLine = (
      line: D365FOCustomerPaymentJournalLineRequest,
      error: string,
    ) => {
      const uniqueId = String(line.customLineApiBody?.PAYMENTID ?? '').trim();
      if (uniqueId && skippedUniqueIds.has(uniqueId)) return;
      if (uniqueId) skippedUniqueIds.add(uniqueId);
      else if (Number(line.LineNumber) > 0) {
        skippedLineNumbers.add(Number(line.LineNumber));
      }
      const marked = line.customLineApiBody?.MarkedLines?.[0];
      skipped.push(
        createCustodySettlementSkipRow({
          uniqueId,
          excelLineNumbers: [
            line.sourceLineNumber,
            ...lines
              .filter(
                (candidate) =>
                  String(candidate.customLineApiBody?.PAYMENTID ?? '').trim() ===
                  uniqueId,
              )
              .map((candidate) => candidate.sourceLineNumber),
          ],
          journalBatchNumber: String(
            line.customLineApiBody?.journalNum ?? '',
          ).trim(),
          d365LineNumbers: [
            line.LineNumber,
            ...lines
              .filter(
                (candidate) =>
                  String(candidate.customLineApiBody?.PAYMENTID ?? '').trim() ===
                  uniqueId,
              )
              .map((candidate) => candidate.LineNumber),
          ],
          vendorAccount: String(
            line.customLineApiBody?.AccountNum ?? '',
          ).trim(),
          invoiceNumber: String(marked?.InvoiceNumber ?? '').trim(),
          documentNumber: String(
            marked?.DocumentNumber ?? line.customLineApiBody?.DocumentNum ?? '',
          ).trim(),
          amount: Math.abs(
            Number(line.customLineApiBody?.creditAmount ?? 0) -
              Number(line.customLineApiBody?.debitAmount ?? 0),
          ),
          phase: 'post',
          error,
        }),
      );
    };

    const postingLines = lines.map((line) => {
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
              DEFAULTDIMENSIONDISPLAYVALUE: normalizeCashCompositeDisplayValue(
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

      const isVendor =
        String(body.accountTypeStr ?? '')
          .trim()
          .toLowerCase() === 'vendor';
      const isCustodyVendorGroup =
        String(body.VendorGroup ?? '')
          .trim()
          .toLowerCase() === 'custody';
      if (!isCustodyVendorGroup) {
        const markedLines = body.MarkedLines ?? [];
        if (markedLines.length > 1) {
          const message = `Custody Settlement line ${line.LineNumber ?? '?'} has ${markedLines.length} invoice marks; OData settlement requires one invoice per journal line.`;
          if (skipFailedUniqueIds) {
            skipLine(line, message);
            return normalizedLine;
          }
          throw new Error(message);
        }
        const markedLine = markedLines[0];
        if (markedLine && isVendor) {
          const invoiceNumber = String(markedLine.InvoiceNumber ?? '').trim();
          if (!invoiceNumber) {
            const message = `Custody Settlement line ${line.LineNumber ?? '?'} cannot use OData settlement without InvoiceNumber.`;
            if (skipFailedUniqueIds) {
              skipLine(line, message);
              return normalizedLine;
            }
            throw new Error(message);
          }
          const uniqueId = String(body.PAYMENTID ?? '').trim();
          deferredSettlements.push({
            lineNumber: line.LineNumber,
            vendorAccount: String(body.AccountNum ?? '').trim(),
            currencyCode: String(body.currency ?? '').trim(),
            debitAmount: Number(body.debitAmount ?? 0),
            creditAmount: Number(body.creditAmount ?? 0),
            invoiceNumber,
            documentNumber: String(markedLine.DocumentNumber ?? '').trim(),
            ...(uniqueId ? { uniqueId } : {}),
            ...(Number(line.sourceLineNumber) > 0
              ? { sourceLineNumber: Number(line.sourceLineNumber) }
              : {}),
          });
        }

        return {
          ...normalizedLine,
          customLineApiBody: {
            ...body,
            // Only Custody keeps MarkedLines in addLedgerJournalTransVendPaym.
            // Other Custody Settlement vendor groups are settled through the
            // OData entity after this line has been created successfully.
            MarkedLines: [],
          },
        };
      }

      if (!isVendor) return normalizedLine;

      const isCustodyCredit = Number(body.creditAmount ?? 0) > 0;
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
        const message = `Custody Settlement vendor credit line ${line.LineNumber ?? '?'} cannot be posted without DocumentNumber in MarkedLines`;
        if (skipFailedUniqueIds) {
          skipLine(line, message);
          return normalizedLine;
        }
        throw new Error(message);
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
              ...(sourceMark?.FullSettlement !== undefined
                ? { FullSettlement: Boolean(sourceMark.FullSettlement) }
                : {}),
            },
          ],
        },
      };
    });

    return {
      postingLines: postingLines.filter((line) => {
        if (skippedLineNumbers.has(Number(line.LineNumber))) return false;
        const uniqueId = String(line.customLineApiBody?.PAYMENTID ?? '').trim();
        return !uniqueId || !skippedUniqueIds.has(uniqueId);
      }),
      deferredSettlements: deferredSettlements.filter(
        (target) =>
          !target.uniqueId || !skippedUniqueIds.has(target.uniqueId),
      ),
      skipped,
    };
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
