/**
 * Template version 2: a petty-cash GL journal line per row, the way the finance team
 * enters it in D365 (journals GL-GNL-0000000000269..273). The row carries the accounts,
 * amounts, tax group and journal; nothing about them comes from company configuration.
 */

export const MAS_JOURNAL_TEMPLATE_VERSION = 2;
export const MAS_JOURNAL_SHEET_NAME = 'Journal Lines';

/**
 * Each internal field with the header texts accepted for it (compared in upper case,
 * with spaces collapsed). The first entry is the canonical header written in the template.
 * Names follow the other Cash templates and the D365 "Open lines in Excel" export.
 */
export const MAS_JOURNAL_HEADERS = {
  journalName: ['JOURNALNAME'],
  transactionDate: ['TRANSDATE'],
  accountType: ['ACCOUNTTYPE'],
  account: ['ACCOUNTDISPLAYVALUE'],
  offsetAccountType: ['OFFSETACCOUNTTYPE'],
  offsetAccount: ['OFFSETACCOUNTDISPLAYVALUE'],
  debit: ['DEBITAMOUNT'],
  credit: ['CREDITAMOUNT'],
  itemSalesTaxGroup: ['ITEMSALESTAXGROUP'],
  document: ['DOCUMENT'],
  text: ['TEXT', 'DESCRIPTION'],
  currency: ['CURRENCYCODE'],
  postingProfile: ['POSTINGPROFILE'],
  salesTaxGroup: ['SALESTAXGROUP'],
  defaultDimension: ['DEFAULTDIMENSIONDISPLAYVALUE'],
  offsetDefaultDimension: ['OFFSETDEFAULTDIMENSIONDISPLAYVALUE'],
  finTag: ['FINTAGDISPLAYVALUE'],
  offsetFinTag: ['OFFSETFINTAGDISPLAYVALUE'],
} as const;

export type MasJournalField = keyof typeof MAS_JOURNAL_HEADERS;

export const MAS_JOURNAL_FIELDS = Object.keys(
  MAS_JOURNAL_HEADERS,
) as MasJournalField[];

/** Columns the file must have. The others are optional. */
export const MAS_JOURNAL_REQUIRED_FIELDS: MasJournalField[] = [
  'journalName',
  'transactionDate',
  'accountType',
  'account',
  'offsetAccountType',
  'offsetAccount',
  'debit',
  'credit',
  'itemSalesTaxGroup',
  'document',
];

/** Template column order, required columns first. */
export const MAS_JOURNAL_TEMPLATE_COLUMNS: MasJournalField[] = [
  ...MAS_JOURNAL_REQUIRED_FIELDS,
  'text',
  'currency',
  'postingProfile',
  'salesTaxGroup',
  'defaultDimension',
  'offsetDefaultDimension',
  'finTag',
  'offsetFinTag',
];

export const MAS_JOURNAL_LIMITS = {
  maxJournalNameLength: 40,
  maxDocumentLength: 60,
  /** D365 financial dimension display values have at most 20 segments (main account + 19). */
  maxCompositeSegments: 20,
} as const;
