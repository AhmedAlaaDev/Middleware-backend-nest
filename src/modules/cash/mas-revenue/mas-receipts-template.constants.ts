/**
 * Template version 3: the receipts workbook. Users enter invoices the way they keep
 * them (date, invoice, customer, value, VAT, total, revenue type, cash account). A
 * second sheet, maintained by finance, says what each revenue type posts to. Every
 * receipt becomes one petty-cash GL journal line, exactly like finance journal
 * GL-GNL-0000000000271: the cash account is debited with the total and the revenue
 * account is the offset.
 */

export const MAS_RECEIPTS_TEMPLATE_VERSION = 3;
export const MAS_RECEIPTS_SHEET_NAME = 'Receipts';
export const MAS_REVENUE_TYPES_SHEET_NAME = 'Revenue Types';
export const MAS_RECEIPTS_GUIDE_SHEET_NAME = 'How to use';

/** Rows above the header row are a title band; the header is found by its texts. */
export const MAS_RECEIPTS_MAX_HEADER_ROW = 10;

/**
 * Receipt fields. The first header text is the one written in the template; the others
 * are accepted so the source workbook's own wording ("Description", "debit", "TYPE")
 * still reads. Compared in upper case with spaces collapsed.
 */
export const MAS_RECEIPT_HEADERS = {
  date: ['DATE', 'TRANSACTION DATE'],
  invoiceNumber: ['INVOICE NO', 'INVOICE NUMBER'],
  customer: ['CUSTOMER', 'DESCRIPTION'],
  revenueType: ['REVENUE TYPE'],
  cashAccount: ['CASH ACCOUNT', 'DEBIT'],
  value: ['VALUE (EXCL. VAT)', 'VALUE'],
  vat: ['VAT'],
  total: ['TOTAL'],
  containerType: ['CONTAINER TYPE', 'TYPE'],
  containerNumber: ['CONTAINER NO', 'CONTAINER NUMBER'],
  billOfLading: ['B/L', 'BILL OF LADING'],
  seaLine: ['SEA LINE', 'SHIPPING LINE'],
  vatCardNumber: ['VAT CARD NO', 'CUSTOMER VAT CARD NO'],
} as const;

export type MasReceiptField = keyof typeof MAS_RECEIPT_HEADERS;

export const MAS_RECEIPT_FIELDS = Object.keys(
  MAS_RECEIPT_HEADERS,
) as MasReceiptField[];

export const MAS_RECEIPT_REQUIRED_FIELDS: MasReceiptField[] = [
  'date',
  'invoiceNumber',
  'customer',
  'revenueType',
  'cashAccount',
  'value',
  'vat',
  'total',
];

/** Display headers written in the template (title case). */
export const MAS_RECEIPT_DISPLAY_HEADERS: Record<MasReceiptField, string> = {
  date: 'Date',
  invoiceNumber: 'Invoice No',
  customer: 'Customer',
  revenueType: 'Revenue Type',
  cashAccount: 'Cash Account',
  value: 'Value (excl. VAT)',
  vat: 'VAT',
  total: 'Total',
  containerType: 'Container Type',
  containerNumber: 'Container No',
  billOfLading: 'B/L',
  seaLine: 'Sea Line',
  vatCardNumber: 'VAT Card No',
};

/** Revenue type mapping fields (the finance sheet). */
export const MAS_REVENUE_TYPE_HEADERS = {
  revenueType: ['REVENUE TYPE'],
  revenueAccount: ['REVENUE ACCOUNT'],
  itemSalesTaxGroup: ['ITEM SALES TAX GROUP'],
  salesTaxGroup: ['SALES TAX GROUP'],
  postingProfile: ['POSTING PROFILE'],
  journalName: ['JOURNAL NAME'],
  description: ['DESCRIPTION'],
} as const;

export type MasRevenueTypeField = keyof typeof MAS_REVENUE_TYPE_HEADERS;

export const MAS_REVENUE_TYPE_FIELDS = Object.keys(
  MAS_REVENUE_TYPE_HEADERS,
) as MasRevenueTypeField[];

export const MAS_REVENUE_TYPE_REQUIRED_FIELDS: MasRevenueTypeField[] = [
  'revenueType',
  'revenueAccount',
  'itemSalesTaxGroup',
  'journalName',
];

export const MAS_REVENUE_TYPE_DISPLAY_HEADERS: Record<
  MasRevenueTypeField,
  string
> = {
  revenueType: 'Revenue Type',
  revenueAccount: 'Revenue Account',
  itemSalesTaxGroup: 'Item Sales Tax Group',
  salesTaxGroup: 'Sales Tax Group',
  postingProfile: 'Posting Profile',
  journalName: 'Journal Name',
  description: 'Description',
};

/** Rows of data the template is formatted and validated for. */
export const MAS_RECEIPTS_TEMPLATE_ROWS = 500;
export const MAS_REVENUE_TYPES_TEMPLATE_ROWS = 50;
