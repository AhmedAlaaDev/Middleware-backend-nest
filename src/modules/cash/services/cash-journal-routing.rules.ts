/**
 * Lookup table for cash-out journal routing.
 * Add/adjust rows here to extend Safe Type coverage without rewriting resolve logic.
 *
 * Acceptance Criteria (task routing):
 * - Vendor Payment / Custody Settlement / Custody Issue Fleet/Freight
 *   → AP P-Fleet/P-Freight
 * - Direct / Other → GL CashOut
 * - DownPayment / CN / Customer Collection → AR Cust-Pay
 */
export type CashJournalRoutingRule =
  | {
      safeTypeToken: string;
      safeType: 'Vendor Payment' | 'Custody Settlement' | 'Custody Issue';
      requiresTargetProcessor: true;
      kind: 'vendor-invoice';
      module: 'AP';
      headerApi: 'VendorPaymentJournalHeaders';
      lineDirection: 'out';
      journalByProcessor: {
        Fleet: 'P-Fleet';
        Freight: 'P-Freight';
      };
    }
  | {
      safeTypeToken: string;
      safeType:
        | 'Customer Collection'
        | 'Direct'
        | 'Other'
        | 'DownPayment'
        | 'CN';
      requiresTargetProcessor: false;
      kind: 'ledger' | 'customer-payment';
      module: 'GL' | 'AR';
      headerApi: 'LedgerJournalHeaders' | 'CustomerPaymentJournalHeaders';
      lineDirection: 'in' | 'out';
      journalName: 'CashOut' | 'Cust-Pay';
    };

export const CASH_JOURNAL_ROUTING_RULES: readonly CashJournalRoutingRule[] = [
  {
    safeTypeToken: 'vendorpayment',
    safeType: 'Vendor Payment',
    requiresTargetProcessor: true,
    kind: 'vendor-invoice',
    module: 'AP',
    headerApi: 'VendorPaymentJournalHeaders',
    lineDirection: 'out',
    journalByProcessor: {
      Fleet: 'P-Fleet',
      Freight: 'P-Freight',
    },
  },
  {
    safeTypeToken: 'custodysettlement',
    safeType: 'Custody Settlement',
    requiresTargetProcessor: true,
    kind: 'vendor-invoice',
    module: 'AP',
    headerApi: 'VendorPaymentJournalHeaders',
    lineDirection: 'out',
    journalByProcessor: {
      Fleet: 'P-Fleet',
      Freight: 'P-Freight',
    },
  },
  {
    safeTypeToken: 'custodyissue',
    safeType: 'Custody Issue',
    requiresTargetProcessor: true,
    kind: 'vendor-invoice',
    module: 'AP',
    headerApi: 'VendorPaymentJournalHeaders',
    lineDirection: 'out',
    journalByProcessor: {
      Fleet: 'P-Fleet',
      Freight: 'P-Freight',
    },
  },
  {
    safeTypeToken: 'customercollection',
    safeType: 'Customer Collection',
    requiresTargetProcessor: false,
    kind: 'customer-payment',
    module: 'AR',
    headerApi: 'CustomerPaymentJournalHeaders',
    lineDirection: 'in',
    journalName: 'Cust-Pay',
  },
  {
    safeTypeToken: 'direct',
    safeType: 'Direct',
    requiresTargetProcessor: false,
    kind: 'ledger',
    module: 'GL',
    headerApi: 'LedgerJournalHeaders',
    lineDirection: 'out',
    journalName: 'CashOut',
  },
  {
    safeTypeToken: 'other',
    safeType: 'Other',
    requiresTargetProcessor: false,
    kind: 'ledger',
    module: 'GL',
    headerApi: 'LedgerJournalHeaders',
    lineDirection: 'out',
    journalName: 'CashOut',
  },
  {
    safeTypeToken: 'downpayment',
    safeType: 'DownPayment',
    requiresTargetProcessor: false,
    kind: 'customer-payment',
    module: 'AR',
    headerApi: 'CustomerPaymentJournalHeaders',
    lineDirection: 'in',
    journalName: 'Cust-Pay',
  },
  {
    safeTypeToken: 'cn',
    safeType: 'CN',
    requiresTargetProcessor: false,
    kind: 'customer-payment',
    module: 'AR',
    headerApi: 'CustomerPaymentJournalHeaders',
    lineDirection: 'in',
    journalName: 'Cust-Pay',
  },
] as const;

export const CASH_JOURNAL_ROUTING_RULE_BY_TOKEN = new Map(
  CASH_JOURNAL_ROUTING_RULES.map((rule) => [rule.safeTypeToken, rule]),
);
