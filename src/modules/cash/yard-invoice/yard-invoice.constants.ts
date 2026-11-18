import { CASH_PAYMENT_REFERENCE_MAX_LENGTH } from '@/modules/cash/policies/cash-payment-reference.policy';

/**
 * Contract for the invoice-driven Yard cash-in upload.
 * The upload contract is the 8-column Yards-Shiplink-Template.xlsx. It is not
 * the same as the multi-sheet Yards.xlsx evidence workbook.
 */
export const YARD_INVOICE_TEMPLATE_SHEET = 'Template';

export const YARD_INVOICE_TEMPLATE_HEADERS = [
  'PaymentSerial',
  'PaymentDate',
  'Payment Type',
  'PaymentNet Total',
  'PaymentCurrency',
  'PaymentReference',
  'SAFE_BankAccount',
  'InvoiceNumber',
] as const;

export type YardInvoiceTemplateHeader =
  (typeof YARD_INVOICE_TEMPLATE_HEADERS)[number];

/** Hard limits applied before any D365 call. */
export const YARD_INVOICE_LIMITS = {
  /** Largest accepted workbook. The Yards source workbook is about 1.3 MB. */
  maxFileBytes: 10 * 1024 * 1024,
  maxDataRows: 2000,
  /** Total uncompressed size of the xlsx package (ZIP bomb guard). */
  maxUncompressedBytes: 50 * 1024 * 1024,
  maxArchiveEntries: 500,
  /** Compression ratio above this, for packages over 1 MB, is rejected. */
  maxCompressionRatio: 100,
  maxInvoiceNumberLength: 60,
  maxSerialLength: 50,
  maxSafeLength: 100,
  /** Same D365 PaymReference EDT limit the Cash-In processor enforces. */
  maxReferenceLength: CASH_PAYMENT_REFERENCE_MAX_LENGTH,
  /** Six decimal places cover the 4-decimal source values with headroom. */
  amountScale: 6,
  maxAmountIntegerDigits: 12,
} as const;

/**
 * Accepted Payment Type values. The keys are lower-cased and the values are
 * the existing EntryVoucherType spellings used by the Cash-In processors.
 * Anything not listed is rejected instead of defaulted.
 */
export const YARD_INVOICE_PAYMENT_TYPES: Readonly<Record<string, string>> = {
  cash: 'Cash',
  cheque: 'Cheque',
  check: 'Cheque',
  transfer: 'Transfer',
  deposit: 'Deposit',
};

/**
 * Tolerance used by the existing customer-settlement balance check
 * (MONEY_TOLERANCE in customer-payment-journal-settlement.service.ts).
 */
export const YARD_INVOICE_BALANCE_TOLERANCE_MAJOR = 0.01;

export const YARD_INVOICE_FEATURE_FLAG = 'YARD_INVOICE_UPLOAD_ENABLED';
