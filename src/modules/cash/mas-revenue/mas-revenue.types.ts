import type { MasRevenueHeaderField } from './mas-revenue.constants';

export class MasRevenueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = MasRevenueError.name;
  }
}

/**
 * How the parser classified a source row before any money rule runs.
 * - blank: no content in any mapped column.
 * - zero-placeholder: amounts are all zero and no identifying content exists.
 *   These are reported and never imported.
 * - cancelled: the debit column carries the CANCEL marker. Reported, not imported.
 * - transaction: a candidate receipt for normalization.
 */
export type MasRevenueRowClassification =
  | 'blank'
  | 'zero-placeholder'
  | 'cancelled'
  | 'transaction';

/** Raw cell text or number as read from the workbook, before normalization. */
export type MasRevenueCellValue = string | number | Date | null;

export interface MasRevenueRawRow {
  sourceSheet: string;
  sourceRow: number;
  classification: MasRevenueRowClassification;
  /** Values keyed by internal field name. Missing cells are null. */
  values: Record<MasRevenueHeaderField, MasRevenueCellValue>;
  /**
   * Fields whose cell holds a formula. Cached results are read, but critical
   * transaction cells that are formulas are rejected by the normalizer.
   */
  formulaFields: MasRevenueHeaderField[];
}

export interface MasRevenueWorkbookParseResult {
  sourceSheet: string;
  headerRow: number;
  /** Header text found per internal field, for error reporting. */
  columnByField: Partial<Record<MasRevenueHeaderField, number>>;
  scannedRowCount: number;
  rows: MasRevenueRawRow[];
}

export interface MasRevenueRowIssue {
  sourceSheet: string;
  sourceRow: number;
  /** Header text of the column the issue is about, when one applies. */
  column: string | null;
  /** The value as read from the source, for correction. */
  originalValue: string | null;
  message: string;
}

/**
 * One normalized receipt: one source row, one D365 journal line.
 * Amounts are integer minor units (cents) so no binary-float sum is used.
 */
/** The two sides a petty-cash journal line can use. */
export type MasJournalAccountType = 'RCash' | 'Ledger';

/**
 * One journal line as the template states it (template version 2). The row carries
 * the accounts, tax group and journal, exactly as the finance team enters them in
 * D365, so none of it comes from company configuration.
 */
export interface MasJournalLine {
  journalName: string;
  accountType: MasJournalAccountType;
  account: string;
  offsetAccountType: MasJournalAccountType;
  offsetAccount: string;
  /** The amount column the row uses: it is on the line's account side. */
  side: 'debit' | 'credit';
  itemSalesTaxGroup: string;
  salesTaxGroup: string;
  postingProfile: string;
  defaultDimension: string;
  offsetDefaultDimension: string;
  finTag: string;
  offsetFinTag: string;
  text: string;
  /** CURRENCYCODE from the file, when given. It must equal the cash account's D365 currency. */
  requestedCurrency: string;
}

export interface MasRevenueReceipt {
  /** Present for template version 2 rows. Legacy (version 1) receipts have none. */
  journalLine?: MasJournalLine;
  /** Identity scheme of the stored snapshot (absent = legacy version 1). */
  identityVersion?: number;
  sourceSheet: string;
  sourceRow: number;
  invoiceNumber: string;
  /** Canonical calendar date, YYYY-MM-DD. */
  transactionDate: string;
  currency: string;
  valueMinor: number;
  vatMinor: number;
  totalMinor: number;
  /** Source display name of the cash account. Not a D365 ID. */
  cashAccountDisplayName: string;
  customerName: string;
  containerType: string | null;
  containerNumber: string | null;
  billOfLading: string | null;
  revenueType: string | null;
  seaLine: string | null;
  vatCardNumber: string | null;
}

export interface MasRevenueNormalizationResult {
  receipts: MasRevenueReceipt[];
  issues: MasRevenueRowIssue[];
  /** Rows the parser classified as non-transactions, for the reconciliation report. */
  nonTransactionRows: {
    blank: number;
    zeroPlaceholder: number;
    cancelled: number;
  };
  /** Every transaction row must end in exactly one of these. */
  accounting: {
    transactionRowsRead: number;
    accepted: number;
    rejected: number;
  };
}
