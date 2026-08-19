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
import { CustomerPaymentJournalService } from '@/modules/d365fo/services/customer-payment-journal.service';
import { D365FOCustomerPaymentJournalLineRequest } from '@/modules/d365fo/types';
import { CustomerPaymentJournalPostingStrategy } from '@/modules/queue/strategies/customer-payment-journal-posting.strategy';
import { LedgerJournalPostingStrategy } from '@/modules/queue/strategies/ledger-journal-posting.strategy';
import { VendorPaymentJournalPostingStrategy } from '@/modules/queue/strategies/vendor-payment-journal-posting.strategy';
import { LedgerJournalLineRequest } from '@/modules/d365fo/types/d365fo-ledger.type';

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
    const existingLinesLoader = () =>
      this.activeHeaderStrategy().listLinesForHeader(headerKey, dataAreaId);

    if (route.kind === 'ledger') {
      return this.ledgerStrategy.postLinesForHeader(
        headerKey,
        typedLines.map((line) => this.toLedgerJournalLine(line)),
        dataAreaId,
        chunkSize,
      );
    }

    return route.lineDirection === 'in'
      ? this.customerPaymentJournalService.postCashInLinesForHeader(
          headerKey,
          typedLines,
          chunkSize,
          dataAreaId,
          existingLinesLoader,
          // This is an outbound Cash-Out transaction even though AR routes
          // use the customer-payment custom API. Preserve task-2031 fallback.
          true,
        )
      : this.customerPaymentJournalService.postCashOutLinesForHeader(
          headerKey,
          typedLines,
          chunkSize,
          dataAreaId,
        existingLinesLoader,
      );
  }

  private toLedgerJournalLine(
    line: D365FOCustomerPaymentJournalLineRequest,
  ): LedgerJournalLineRequest {
    const body = line.customLineApiBody as any;
    const accountType = this.toLedgerAccountType(
      body.accountTypeStr ?? body.AccountTypeStr,
    );
    const offsetDisplay = String(
      body.offsetAccountDisplayValue ?? body.OffsetAccountDisplayValue ?? '',
    );
    const offsetType = offsetDisplay
      ? this.toLedgerAccountType(body.OffsetAccountTypeStr)
      : undefined;
    const paymentMethod = this.sanitizePaymentMethod(body.PAYMENTMETHODNAME);
    // The Cash API sends its own 19-segment dimension-only format.  It is not
    // the active DefaultDimensionDisplayValue format of LedgerJournalLineEntity
    // (this also applies to Vend/Bank/RCash lines). Sending it makes Finance
    // reject the whole row before X++ can resolve the account combination.
    // Ledger account combinations remain in AccountDisplayValue; the other
    // account types are resolved by their account display value and posting
    // profile.
    return {
      dataAreaId: line.dataAreaId,
      JournalBatchNumber: '',
      AccountType: accountType,
      AccountDisplayValue: String(body.AccountNum ?? ''),
      Text: String(body.TRANSACTIONTEXT ?? ''),
      DebitAmount: Number(body.debitAmount ?? 0),
      CreditAmount: Number(body.creditAmount ?? 0),
      ...(offsetType && offsetDisplay
        ? {
            OffsetAccountType: offsetType,
            OffsetAccountDisplayValue: offsetDisplay,
            OffsetText: String(body.OFFSETTRANSACTIONTEXT ?? ''),
          }
        : {}),
      CurrencyCode: String(body.currency ?? ''),
      TransDate: this.toOdataDateTimeOffset(body.transDate),
      DocumentDate: this.toOdataDateTimeOffset(body.DocumentDate),
      Document: String(body.DocumentNum ?? ''),
      Invoice: String(body.INVOICE ?? ''),
      PostingProfile: String(body.PostingProfile ?? ''),
      ...(paymentMethod ? { PaymentMethod: paymentMethod } : {}),
      FinTagDisplayValue: String(body.FinTagStr ?? ''),
      PaymentId: String(body.PAYMENTID ?? ''),
    };
  }

  private sanitizePaymentMethod(value: unknown): string {
    const method = String(value ?? '').trim();
    if (!method) return '';
    if (
      /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(method) ||
      /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(method) ||
      /^\d{4}-\d{2}-\d{2}T/.test(method)
    ) {
      return '';
    }
    return method;
  }

  private toLedgerAccountType(value: unknown): string {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'vendor' || normalized === 'vend') return 'Vend';
    if (normalized === 'bank') return 'Bank';
    // LedgerJournalACType includes RCash. Mapping petty cash to Bank makes
    // Finance look up the cash account id (for example ALEXHO EG) in the Bank
    // dimension and reject the LedgerJournalLineEntity row.
    if (normalized === 'petty cash' || normalized === 'rcash') return 'RCash';
    return 'Ledger';
  }

  private toOdataDateTimeOffset(value: unknown): string {
    const date = String(value ?? '').trim();
    if (!date) return '';
    const day = date.match(/^(\d{4}-\d{2}-\d{2})/);
    const normalized = day ? `${day[1]}T00:00:00` : date;
    return /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
      ? normalized
      : `${normalized}Z`;
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

  public async getJournalIntegrityState(
    headerKey: string,
    dataAreaId: string,
  ): Promise<{
    headerExists: boolean;
    lineCount: number;
    headerDescription?: string;
  }> {
    const active = this.activeHeaderStrategy();
    if (!active.getHeaderIdentity) {
      throw new Error(
        `The ${this.requireRoute().headerApi} strategy cannot verify journal identity`,
      );
    }

    const header = await active.getHeaderIdentity(headerKey, dataAreaId);
    if (!header) return { headerExists: false, lineCount: 0 };
    const lines = await active.listLinesForHeader(headerKey, dataAreaId);
    return {
      headerExists: true,
      lineCount: lines.length,
      headerDescription: header.Description,
    };
  }

  public findHeadersByIntegrationMarker(
    integrationMarker: string,
    dataAreaId: string,
  ): Promise<string[]> {
    const active = this.activeHeaderStrategy();
    if (!active.findHeadersByIntegrationMarker) return Promise.resolve([]);
    return active.findHeadersByIntegrationMarker(integrationMarker, dataAreaId);
  }

  public repairDuplicatedUnmarkedFallbackLines(
    headerKey: string,
    expectedLineCount: number,
    dataAreaId: string,
  ): Promise<boolean> {
    const route = this.requireRoute();
    if (route.kind !== 'vendor-invoice' || route.lineDirection !== 'out') {
      return Promise.resolve(false);
    }
    return this.customerPaymentJournalService.repairDuplicatedUnmarkedFallbackLines(
      headerKey,
      expectedLineCount,
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
