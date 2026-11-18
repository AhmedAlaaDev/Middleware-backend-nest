import { Micro } from './yard-invoice-decimal';

/**
 * Which accepted upload format a record came from. The formats are not
 * interchangeable: the eight-column template carries a payment serial and no
 * customer or dimension data; the Yards source workbook carries customer,
 * dimension and tag values from the source system and no serial.
 */
export type YardUploadFormat = 'TEMPLATE_8' | 'YARDS_SOURCE';

/**
 * Common Yard payment model. Both formats map into this shape. Every record
 * keeps its source sheet and worksheet row for audit and review.
 */
export interface YardPaymentRecord {
  format: YardUploadFormat;
  /** 'Template' for the eight-column format; the source sheet name otherwise. */
  sourceSheet: string;
  /** Layout id from the format definition, for example 'YARDS_LAYOUT_IST'. */
  layoutId: string;
  /** 1-based worksheet row number. */
  sourceRow: number;
  /** Only the eight-column template has a serial. Null for the Yards source. */
  paymentSerial: string | null;
  /** Canonical calendar date, YYYY-MM-DD. */
  paymentDate: string;
  /** Canonical value: Cash, Cheque, Transfer or Deposit. */
  paymentType: string;
  /** Payment Type exactly as it appears in the workbook. */
  rawPaymentType: string;
  /** Signed exact amount. Negative values are kept for reporting (credit notes). */
  amount: Micro;
  amountText: string;
  currencyCode: string;
  /** Exact text after trimming; empty when the source has none. */
  paymentReference: string;
  /** Trimmed SAFE / bank value; becomes OFFSETACCOUNTDISPLAYVALUE after validation. */
  safeBankAccount: string;
  /** Exact text after trimming surrounding whitespace only. */
  invoiceNumber: string;
  /** Source-system customer account (Yards only). Compared with D365, never trusted. */
  workbookCustomerAccount: string | null;
  /** Source-system customer name (Yards sheet 10-YARD-IST only). Informational. */
  workbookCustomerName: string | null;
  /** Source-system default dimension display value (Yards only). Compared with D365. */
  workbookDimension: string | null;
  /** Source-system header financial tag (Yards only). Compared with D365. */
  workbookFinTag: string | null;
  /** True when the invoice number ends in -CN. Credit notes are never posted by this flow. */
  isCreditNote: boolean;
}

export interface YardRecordIssue {
  sourceSheet: string;
  sourceRow: number;
  column: string;
  message: string;
}

export function isCreditNoteInvoice(invoiceNumber: string): boolean {
  return /-CN$/i.test(invoiceNumber.trim());
}
