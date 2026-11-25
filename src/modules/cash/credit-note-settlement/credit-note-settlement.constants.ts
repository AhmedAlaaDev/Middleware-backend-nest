/**
 * Credit note settlement upload. Each template row pairs an open customer credit
 * note with the open invoice it reverses. Posting creates, per pair, two customer
 * lines with no offset in a Cust-Pay journal: a debit line that marks the credit
 * note and a credit line that marks the invoice. The journal name allocates
 * vouchers "in connection with balance", so the two lines share one voucher. The
 * journal is left unposted; finance posts it in D365.
 */
export const CREDIT_NOTE_SETTLEMENT_SHEET = 'Settlement';

export const CREDIT_NOTE_SETTLEMENT_HEADERS = [
  'CreditNoteVoucher',
  'CreditNoteInvoice',
  'Customer',
  'CreditNoteAmount',
  'OriginalVoucher',
  'OriginalInvoice',
  'OriginalAmount',
  'Currency',
  'SettleAmount',
  'Notes',
] as const;

export type CreditNoteSettlementHeader =
  (typeof CREDIT_NOTE_SETTLEMENT_HEADERS)[number];

export const CREDIT_NOTE_SETTLEMENT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  /** Two journal lines per pair; 500 pairs stay inside one 1,000-line journal. */
  maxPairs: 500,
  /** Amounts are compared in cents. */
  tolerance: 0.01,
};

/** Journal name whose vouchers are allocated in connection with balance. */
export const CREDIT_NOTE_SETTLEMENT_JOURNAL_NAME = 'Cust-Pay';

/** Provisional batch number; D365 returns the real journal number on create. */
export const CREDIT_NOTE_SETTLEMENT_JOURNAL_BATCH = 'CN-SETTLEMENT';

/** Marker carried on every line of this flow (SafeType), used at posting. */
export const CREDIT_NOTE_SETTLEMENT_SAFE_TYPE = 'Credit Note Settlement';

export const CREDIT_NOTE_SETTLEMENT_FEATURE_FLAG =
  'CREDIT_NOTE_SETTLEMENT_ENABLED';

export function isCreditNoteSettlementEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = String(env[CREDIT_NOTE_SETTLEMENT_FEATURE_FLAG] ?? '')
    .trim()
    .toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}
