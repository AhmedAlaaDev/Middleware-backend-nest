import { Injectable } from '@nestjs/common';

import {
  CASH_JOURNAL_ROUTING_RULE_BY_TOKEN,
  type CashJournalRoutingRule,
} from './cash-journal-routing.rules';

export type CashTargetProcessor = 'Fleet' | 'Freight';
export type CashJournalModule = 'AP' | 'GL' | 'AR';
export type CashJournalRouteKind =
  | 'vendor-invoice'
  | 'ledger'
  | 'customer-payment';
export type CashJournalHeaderApi =
  | 'VendorPaymentJournalHeaders'
  | 'LedgerJournalHeaders'
  | 'CustomerPaymentJournalHeaders';

export interface CashJournalRoute {
  kind: CashJournalRouteKind;
  module: CashJournalModule;
  safeType:
    | 'Vendor Payment'
    | 'Custody Settlement'
    | 'Custody Issue'
    | 'Customer Collection'
    | 'Direct'
    | 'Other'
    | 'DownPayment'
    | 'CN';
  targetProcessor?: CashTargetProcessor;
  journalName: 'P-Fleet' | 'P-Freight' | 'CustSettle' | 'CashOut' | 'Cust-Pay';
  headerApi: CashJournalHeaderApi;
  lineDirection: 'in' | 'out';
}

export interface ResolveCashJournalRouteInput {
  safeType: unknown;
  targetProcessor?: unknown;
  /**
   * Voucher Type intentionally does not choose the D365 journal family.
   * It remains an input to the existing Cash/Cheque/Other batching rules.
   */
  voucherType?: unknown;
}

export class CashJournalRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = CashJournalRoutingError.name;
  }
}

/**
 * Cash-out journal header routing from the configurable lookup table.
 *
 * Safe Type chooses the D365 journal module. Target Processor is required only
 * for Vendor Payment; Custody Settlement / Custody Issue / Any-routes ignore it.
 */
@Injectable()
export class CashJournalRoutingService {
  public resolve(input: ResolveCashJournalRouteInput): CashJournalRoute {
    const safeTypeToken = this.normalizeToken(input.safeType);
    const rule = CASH_JOURNAL_ROUTING_RULE_BY_TOKEN.get(safeTypeToken);

    if (!rule) {
      throw new CashJournalRoutingError(
        `Unsupported Safe Type "${this.displayValue(input.safeType)}". Supported values are Vendor Payment, Custody Settlement, Custody Issue, Customer Collection, Direct, Other, DownPayment, and CN.`,
      );
    }

    if (rule.requiresTargetProcessor) {
      return this.resolveApPaymentRoute(rule, input.targetProcessor);
    }

    return {
      kind: rule.kind,
      module: rule.module,
      safeType: rule.safeType,
      journalName: rule.journalName,
      headerApi: rule.headerApi,
      lineDirection: rule.lineDirection,
    };
  }

  private resolveApPaymentRoute(
    rule: Extract<CashJournalRoutingRule, { requiresTargetProcessor: true }>,
    target: unknown,
  ): CashJournalRoute {
    const targetProcessor = this.normalizeToken(target);

    if (targetProcessor === 'fleet') {
      return {
        kind: rule.kind,
        module: rule.module,
        safeType: rule.safeType,
        targetProcessor: 'Fleet',
        journalName: rule.journalByProcessor.Fleet,
        headerApi: rule.headerApi,
        lineDirection: rule.lineDirection,
      };
    }

    if (targetProcessor === 'freight') {
      return {
        kind: rule.kind,
        module: rule.module,
        safeType: rule.safeType,
        targetProcessor: 'Freight',
        journalName: rule.journalByProcessor.Freight,
        headerApi: rule.headerApi,
        lineDirection: rule.lineDirection,
      };
    }

    throw new CashJournalRoutingError(
      `${rule.safeType} requires a valid Target Processor. Received "${this.displayValue(target)}"; expected Fleet or Freight.`,
    );
  }

  private normalizeToken(value: unknown): string {
    return this.safeString(value)
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '');
  }

  private displayValue(value: unknown): string {
    const displayed = this.safeString(value).trim();
    return displayed || '(empty)';
  }

  private safeString(value: unknown): string {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }
    return '';
  }
}
