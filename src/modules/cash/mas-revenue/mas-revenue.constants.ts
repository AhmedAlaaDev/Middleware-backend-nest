/**
 * MAS Revenue Cash In: constants.
 *
 * Evidence: "templet of revenue.xlsx" (sheet "Row Data", table Table1511).
 * Headers are matched by text, not by column position, so a re-ordered
 * export still parses. Required headers are listed in
 * MAS_REVENUE_REQUIRED_HEADERS; the rest are informational.
 */

export const MAS_REVENUE_COMPANY_ID = 'mas';

/** Canonical contract version for this source adapter. */
export const MAS_REVENUE_TEMPLATE_VERSION = 1;

export const MAS_REVENUE_SHEET_NAME = 'Row Data';

/** Marker text the source uses in the debit column for cancelled rows. */
export const MAS_REVENUE_CANCEL_MARKER = 'CANCEL';

export const MAS_REVENUE_LIMITS = {
  /** Largest accepted workbook, in bytes. */
  maxFileBytes: 10 * 1024 * 1024,
  /** Largest sheet row count scanned (the source sheet has about 16.5k rows). */
  maxScannedRows: 50_000,
  /** Largest number of transaction rows accepted in one upload. */
  maxTransactionRows: 5_000,
  /** Invoice numbers are source identifiers, kept as text. */
  maxInvoiceNumberLength: 60,
  /** Unverified D365 text limit; kept conservative until metadata is checked. */
  maxTransactionTextLength: 100,
  /** Largest absolute amount, in minor units (12 integer digits + 2 decimals). */
  maxAmountMinorUnits: 999_999_999_999_99,
} as const;

/**
 * Canonical template headers, keyed by the internal field they populate. These
 * are the labels the downloadable template uses and the labels users fill in.
 */
export const MAS_REVENUE_HEADERS = {
  transactionDate: 'Date',
  invoiceNumber: 'Invoice No',
  value: 'Value',
  vat: 'VAT',
  total: 'Total',
  containerType: 'TYPE',
  /** The source fills this column with the customer name. */
  customerName: 'Description',
  vatCardNumber: 'VAT card no',
  containerNumber: 'Container no',
  billOfLading: 'B/L',
  revenueType: 'Revenue type',
  seaLine: 'Sea line',
  /** The source fills this column with the cash account display name. */
  cashAccountName: 'debit',
  /** Must be empty in every transaction row; a populated credit is rejected. */
  creditColumn: 'credit',
} as const;

export type MasRevenueHeaderField = keyof typeof MAS_REVENUE_HEADERS;

/**
 * Older source labels that are still accepted for the historical Arabic layout
 * (the source workbook this flow was built from). They are aliases only: a
 * workbook using them is read exactly as before, and the template never uses them.
 * Text is compared after whitespace normalization.
 */
export const MAS_REVENUE_HEADER_ALIASES: Partial<
  Record<MasRevenueHeaderField, readonly string[]>
> = {
  transactionDate: ['التاريخ'],
  invoiceNumber: ['رقم الفاتورة'],
  value: ['القيمة'],
  vat: ['الضريبة'],
  total: ['الاجمالي'],
  vatCardNumber: ['رقم البطاقة الضريبية'],
  containerNumber: ['رقم الحاوية'],
  revenueType: ['نوع الايراد'],
  seaLine: ['الخط الملاحي'],
} as const;

export const MAS_REVENUE_REQUIRED_HEADERS: MasRevenueHeaderField[] = [
  'transactionDate',
  'invoiceNumber',
  'value',
  'vat',
  'total',
  'customerName',
  'cashAccountName',
];

/**
 * Template columns in the order the upload contract defines them (A to N).
 * The template and the header check both use this order.
 */
export const MAS_REVENUE_TEMPLATE_COLUMNS: MasRevenueHeaderField[] = [
  'transactionDate',
  'invoiceNumber',
  'value',
  'vat',
  'total',
  'containerType',
  'customerName',
  'vatCardNumber',
  'containerNumber',
  'billOfLading',
  'revenueType',
  'seaLine',
  'cashAccountName',
  'creditColumn',
];

/** Field kinds drive the template number formats and the guide. */
export type MasRevenueFieldKind = 'date' | 'text' | 'amount';

export interface MasRevenueFieldSpec {
  kind: MasRevenueFieldKind;
  requirement: 'required' | 'optional' | 'must-be-empty';
  width: number;
  /** One-line business meaning, shown in the guide. */
  meaning: string;
  example: string;
}

/**
 * Single source of column metadata for the template, the guide and the
 * user-facing help. Validation rules live in the normalizer; this table
 * describes them for users and must be kept in agreement with it.
 */
export const MAS_REVENUE_FIELD_SPECS: Record<
  MasRevenueHeaderField,
  MasRevenueFieldSpec
> = {
  transactionDate: {
    kind: 'date',
    requirement: 'required',
    width: 14,
    meaning: 'Receipt (transaction) date.',
    example: '2026-10-28',
  },
  invoiceNumber: {
    kind: 'text',
    requirement: 'required',
    width: 14,
    meaning: 'Source invoice number. Must be unique within the file.',
    example: 'INV-000123',
  },
  value: {
    kind: 'amount',
    requirement: 'required',
    width: 14,
    meaning: 'Net amount before VAT, in the upload currency.',
    example: '1600.00',
  },
  vat: {
    kind: 'amount',
    requirement: 'required',
    width: 12,
    meaning:
      'VAT amount. Must equal the configured VAT rate of Value (enter 0.00 for an exempt row). Credited once, to the VAT account in the tax configuration.',
    example: '224.00',
  },
  total: {
    kind: 'amount',
    requirement: 'required',
    width: 14,
    meaning: 'Total received: Value plus VAT. Must be greater than zero.',
    example: '1824.00',
  },
  containerType: {
    kind: 'text',
    requirement: 'optional',
    width: 12,
    meaning: 'Container type code from the source (free text, not validated).',
    example: '20DC',
  },
  customerName: {
    kind: 'text',
    requirement: 'required',
    width: 28,
    meaning: 'Customer name (the source "Description" column).',
    example: 'Example Customer Ltd',
  },
  vatCardNumber: {
    kind: 'text',
    requirement: 'optional',
    width: 18,
    meaning: 'Customer tax card number, kept as text.',
    example: '100000001',
  },
  containerNumber: {
    kind: 'text',
    requirement: 'optional',
    width: 16,
    meaning: 'Container number, kept as text.',
    example: 'ABCU1234567',
  },
  billOfLading: {
    kind: 'text',
    requirement: 'optional',
    width: 18,
    meaning: 'Bill of lading number, kept as text.',
    example: 'BL000001',
  },
  revenueType: {
    kind: 'text',
    requirement: 'optional',
    width: 14,
    meaning:
      'Revenue type. Selects the revenue account credited for the row. Must match a configured Revenue type exactly; a type without a verified account is rejected.',
    example: 'In',
  },
  seaLine: {
    kind: 'text',
    requirement: 'optional',
    width: 16,
    meaning: 'Sea line name (free text).',
    example: 'Example Line',
  },
  cashAccountName: {
    kind: 'text',
    requirement: 'required',
    width: 26,
    meaning:
      'Cash account name that is debited for the receipt. It must be a configured cash account; any other value is rejected, because only direct cash revenue is supported.',
    example: 'Port Said Treasury',
  },
  creditColumn: {
    kind: 'text',
    requirement: 'must-be-empty',
    width: 12,
    meaning:
      'Must stay empty. Populated credits are not supported in this flow.',
    example: '',
  },
};

/** Template contract version. Bump only with a documented change to the headers or meanings. */
export const MAS_REVENUE_TEMPLATE_VERSION_LABEL = 'v1';

export function masRevenueTemplateFileName(): string {
  return `MAS-Revenue-Cash-In-Template-${MAS_REVENUE_TEMPLATE_VERSION_LABEL}.xlsx`;
}
