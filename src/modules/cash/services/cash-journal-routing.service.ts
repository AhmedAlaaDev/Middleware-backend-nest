import { Injectable } from '@nestjs/common';

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
 * Task 2045 routing matrix for cash-out journal headers.
 *
 * Safe Type chooses the D365 journal module. Target Processor is consulted
 * only for Vendor Payment; all other rules deliberately ignore it.
 */
@Injectable()
export class CashJournalRoutingService {
  public resolve(input: ResolveCashJournalRouteInput): CashJournalRoute {
    const safeType = this.normalizeToken(input.safeType);

    switch (safeType) {
      case 'vendorpayment':
        return this.resolveVendorPayment(input.targetProcessor);
      case 'custodysettlement':
        return {
          ...this.resolveVendorPaymentWithDefault(input.targetProcessor),
          safeType: 'Custody Settlement',
        };
      case 'custodyissue':
        return {
          ...this.resolveVendorPaymentWithDefault(input.targetProcessor),
          safeType: 'Custody Issue',
        };
      case 'customercollection':
        return {
          kind: 'customer-payment',
          module: 'AR',
          safeType: 'Customer Collection',
          journalName: 'Cust-Pay',
          headerApi: 'CustomerPaymentJournalHeaders',
          lineDirection: 'in',
        };
      case 'direct':
        return {
          kind: 'ledger',
          module: 'GL',
          safeType: 'Direct',
          journalName: 'CashOut',
          headerApi: 'LedgerJournalHeaders',
          lineDirection: 'out',
        };
      case 'other':
        return {
          kind: 'ledger',
          module: 'GL',
          safeType: 'Other',
          journalName: 'CashOut',
          headerApi: 'LedgerJournalHeaders',
          lineDirection: 'out',
        };
      case 'downpayment':
        return {
          kind: 'customer-payment',
          module: 'AR',
          safeType: 'DownPayment',
          journalName: 'Cust-Pay',
          headerApi: 'CustomerPaymentJournalHeaders',
          lineDirection: 'in',
        };
      case 'cn':
        return {
          kind: 'customer-payment',
          module: 'AR',
          safeType: 'CN',
          journalName: 'Cust-Pay',
          headerApi: 'CustomerPaymentJournalHeaders',
          lineDirection: 'in',
        };
      default:
        throw new CashJournalRoutingError(
          `Unsupported Safe Type "${this.displayValue(input.safeType)}". Supported values are Vendor Payment, Custody Settlement, Custody Issue, Customer Collection, Direct, Other, DownPayment, and CN.`,
        );
    }
  }

  private resolveVendorPayment(target: unknown): CashJournalRoute {
    const targetProcessor = this.normalizeToken(target);

    if (targetProcessor === 'fleet') {
      return {
        kind: 'vendor-invoice',
        module: 'AP',
        safeType: 'Vendor Payment',
        targetProcessor: 'Fleet',
        journalName: 'P-Fleet',
        headerApi: 'VendorPaymentJournalHeaders',
        lineDirection: 'out',
      };
    }

    if (targetProcessor === 'freight') {
      return {
        kind: 'vendor-invoice',
        module: 'AP',
        safeType: 'Vendor Payment',
        targetProcessor: 'Freight',
        journalName: 'P-Freight',
        headerApi: 'VendorPaymentJournalHeaders',
        lineDirection: 'out',
      };
    }

    throw new CashJournalRoutingError(
      `Vendor Payment requires a valid Target Processor. Received "${this.displayValue(target)}"; expected Fleet or Freight.`,
    );
  }

  private resolveVendorPaymentWithDefault(target: unknown): CashJournalRoute {
    const targetProcessor = this.normalizeToken(target);

    if (targetProcessor === 'fleet') {
      return {
        kind: 'vendor-invoice',
        module: 'AP',
        safeType: 'Vendor Payment',
        targetProcessor: 'Fleet',
        journalName: 'P-Fleet',
        headerApi: 'VendorPaymentJournalHeaders',
        lineDirection: 'out',
      };
    }

    return {
      kind: 'vendor-invoice',
      module: 'AP',
      safeType: 'Vendor Payment',
      targetProcessor: 'Freight',
      journalName: 'P-Freight',
      headerApi: 'VendorPaymentJournalHeaders',
      lineDirection: 'out',
    };
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
