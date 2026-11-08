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
  isCustodySettlementSkipRoute,
} from '@/modules/cash/services/cash-journal-routing.service';
import {
  createCustodySettlementSkipRow,
  CustodySettlementSkipRow,
  isAlreadyMarkedUnmarkedUploadSkip,
} from '@/modules/cash/services/custody-settlement-skip-report';
import { NonRetryableDfoPostingError } from '@/modules/d365fo/errors/non-retryable-dfo-posting.error';
import {
  ActualJournalLine,
  toPlannedJournalLine,
} from '@/modules/d365fo/services/cash-journal-line-identity';
import {
  formatJournalIntegrityFailure,
  verifyJournalContent,
} from '@/modules/d365fo/services/cash-journal-readback';
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

  /**
   * Vendor Payment invoices are checked before a D365 header is created.
   * Custody Settlement keeps UniqueId skip-and-report instead of failing the
   * whole journal up front.
   */
  public async validateLinesBeforeHeader(
    lines: unknown[],
    dataAreaId: string,
  ): Promise<void> {
    const route = this.requireRoute();
    if (route.lineDirection !== 'out' || route.safeType !== 'Vendor Payment') {
      return;
    }

    const typedLines = lines as D365FOCustomerPaymentJournalLineRequest[];
    const requests = typedLines.flatMap((line) => {
      const body = line.customLineApiBody;
      const vendorAccount = String(body?.AccountNum ?? '').trim();
      const accountType = String(body?.accountTypeStr ?? '')
        .trim()
        .toLowerCase();
      if (
        !body ||
        !vendorAccount ||
        (accountType !== 'vendor' && accountType !== 'vend')
      ) {
        return [];
      }
      return (body.MarkedLines ?? [])
        .map((mark) => ({
          invoice: String(mark.InvoiceNumber ?? '').trim(),
          vendorAccount,
          documentNumber: String(mark.DocumentNumber ?? '').trim() || undefined,
        }))
        .filter((request) => Boolean(request.invoice));
    });
    if (requests.length === 0) return;

    const snapshots =
      await this.vendorInvoiceJournalService.findInvoiceSettlementSnapshots(
        dataAreaId,
        requests,
      );
    const mismatch = requests.some((request) => {
      const snapshot = VendorInvoiceJournalService.findSettlementSnapshot(
        snapshots,
        request.invoice,
        request.vendorAccount,
        request.documentNumber,
      );
      return Boolean(snapshot?.exists && !snapshot.belongsToVendor);
    });
    if (mismatch) {
      throw new NonRetryableDfoPostingError(
        'Cash-out settlement preflight failed: invoice/vendor mismatch',
      );
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
    const skipFailedUniqueIds = isCustodySettlementSkipRoute(route);
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

    if (skipFailedUniqueIds && route.lineDirection === 'out') {
      // A successful HTTP response does not prove the journal is right.
      // Compare the COMPLETE actual D365 journal with the expected one before
      // any settlement mark is made.
      await this.verifyPostedJournal(
        headerKey,
        dataAreaId,
        postingLines,
        new Set(postedLines.map((line) => Number(line.lineNumber))),
      );
    }

    const skippedUniqueIds = new Set(
      this.skipReport
        .filter((row) => !isAlreadyMarkedUnmarkedUploadSkip(row))
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

  /**
   * Post-write integrity gate for Custody Settlement. The EXPECTED journal is
   * the batch's planned lines for this header minus the UniqueIds that were
   * skipped; the ACTUAL journal is every line D365 holds for it (all pages).
   * They are compared line by line by content identity, never by planned line
   * number (D365 renumbers) and never by counts or totals alone (a missing
   * debit and a duplicated credit still add up). Any discrepancy stops the
   * flow BEFORE settlement marks are written, and the journal is left as it is
   * for controlled recovery.
   */
  private async verifyPostedJournal(
    headerKey: string,
    dataAreaId: string,
    postingLines: D365FOCustomerPaymentJournalLineRequest[],
    postedLineNumbers: ReadonlySet<number>,
  ): Promise<void> {
    const planned = postingLines
      .filter(
        (line) =>
          line.customLineApiBody && postedLineNumbers.has(Number(line.LineNumber)),
      )
      .map((line) =>
        toPlannedJournalLine(Number(line.LineNumber), line.customLineApiBody),
      );

    const active = this.activeHeaderStrategy();
    if (!active.listJournalLineDetails) {
      throw new NonRetryableDfoPostingError(
        `[JOURNAL_READBACK_FAILED] Journal ${headerKey} cannot be read back for this route. Invoice settlement marks were not written.`,
      );
    }

    let actual: ActualJournalLine[];
    try {
      actual = await active.listJournalLineDetails(headerKey, dataAreaId);
    } catch (error: unknown) {
      throw new NonRetryableDfoPostingError(
        `[JOURNAL_READBACK_FAILED] Could not read journal ${headerKey} back from D365 (${error instanceof Error ? error.message : String(error)}). Invoice settlement marks were not written.`,
      );
    }

    const errors = verifyJournalContent({
      journalNumber: headerKey,
      planned,
      actual,
      // X++ balances only offset-less lines, so voucher balance is a valid
      // invariant only when every expected line is offset-less.
      checkVoucherBalance:
        planned.length > 0 && planned.every((line) => line.offsetless),
    });
    if (errors.length > 0) {
      throw new NonRetryableDfoPostingError(
        formatJournalIntegrityFailure(errors),
      );
    }
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

  public headerExists(headerId: string, dataAreaId: string): Promise<boolean> {
    const active = this.activeHeaderStrategy();
    if (!active.headerExists) {
      return Promise.reject(
        new Error(
          'Header existence cannot be verified for this cash journal route',
        ),
      );
    }
    return active.headerExists(headerId, dataAreaId);
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
      // Native withholding: X++ writes ITEMWITHHOLDINGTAXGROUP into the D365
      // line's TaxWithholdGroup (verified in the sandbox). It never sets the
      // calculation flag, which the settlement step enables afterwards.
      if (line.nativeWithholding) {
        body.ITEMWITHHOLDINGTAXGROUP = line.nativeWithholding.withholdingGroup;
      }
      const normalizedLine = { ...line, customLineApiBody: body };
      // Vendor Payment normally lets X++ mark the invoice, but X++ marks only
      // the line's own (net) amount. A native-withholding line must be marked
      // for the GROSS amount, so it takes the same OData settlement route as
      // Custody Settlement invoice lines. Every other Vendor Payment line is
      // untouched.
      const isNativeVendorPayment =
        route.safeType === 'Vendor Payment' && Boolean(line.nativeWithholding);
      if (route.safeType !== 'Custody Settlement' && !isNativeVendorPayment) {
        return normalizedLine;
      }

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
          const message = `${route.safeType} line ${line.LineNumber ?? '?'} has ${markedLines.length} invoice marks; OData settlement requires one invoice per journal line.`;
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
            const message = `${route.safeType} line ${line.LineNumber ?? '?'} cannot use OData settlement without InvoiceNumber.`;
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
            ...(line.nativeWithholding
              ? {
                  withholdingAmount: line.nativeWithholding.withholdingAmount,
                  withholdingGroup: line.nativeWithholding.withholdingGroup,
                }
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
              // Keep InvoiceNumber for OData fallback when X++ skips an
              // already-marked open trans. VendorGroup stays Custody, so
              // addLedgerJournalTransVendPaym still settles by document.
              InvoiceNumber: String(sourceMark?.InvoiceNumber ?? '').trim(),
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

    const keptLines = postingLines.filter((line) => {
      if (skippedLineNumbers.has(Number(line.LineNumber))) return false;
      const uniqueId = String(line.customLineApiBody?.PAYMENTID ?? '').trim();
      return !uniqueId || !skippedUniqueIds.has(uniqueId);
    });

    // A native-withholding line has no explicit 223304 entry: D365 only
    // accounts for the tax if the settlement step enables the calculation on
    // it. If such a line would not reach that step, stop instead of posting a
    // journal that silently lacks the withholding.
    for (const line of keptLines) {
      if (!line.nativeWithholding) continue;
      const hasTarget = deferredSettlements.some(
        (target) =>
          target.lineNumber === line.LineNumber &&
          !(target.uniqueId && skippedUniqueIds.has(target.uniqueId)),
      );
      if (!hasTarget) {
        throw new Error(
          `[WITHHOLDING_NOT_ENABLED] ${route.safeType} line ${line.LineNumber} relies on native withholding but has no invoice settlement target to enable it; refusing to post without the withholding entry.`,
        );
      }
    }

    return {
      postingLines: keptLines,
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
