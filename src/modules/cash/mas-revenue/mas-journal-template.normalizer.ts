import { cashEffectOf } from './mas-journal-line';
import {
  MAS_JOURNAL_HEADERS,
  MAS_JOURNAL_LIMITS,
  type MasJournalField,
} from './mas-journal-template.constants';
import { parseMinor, toIsoDate } from './mas-revenue-normalizer';
import { normalizeSourceText } from './mas-revenue-workbook.parser';
import { MAS_REVENUE_LIMITS } from './mas-revenue.constants';
import {
  MasJournalAccountType,
  MasJournalLine,
  MasRevenueCellValue,
  MasRevenueError,
  MasRevenueNormalizationResult,
  MasRevenueReceipt,
  MasRevenueRowIssue,
} from './mas-revenue.types';

import type { MasJournalParseResult } from './mas-journal-template.parser';

/** Fields a formula must never supply: they decide the accounting and the identity. */
const CRITICAL_FORMULA_FIELDS: MasJournalField[] = [
  'transactionDate',
  'document',
  'account',
  'offsetAccount',
  'debit',
  'credit',
];

/**
 * Turns the version 2 rows into receipts, one per row. Every transaction row ends
 * either as an accepted receipt or as a rejected row with at least one issue.
 *
 * This checks the shape of each row only. Whether the accounts, tax group and journal
 * exist in D365 is checked against D365 afterwards (read-only). Nothing is defaulted:
 * a missing account, tax group or journal name is an issue, not a guess.
 *
 * The currency is not read here. It is the D365 currency of the cash account, resolved
 * afterwards. A CURRENCYCODE in the file is kept only so it can be checked against that.
 */
export function normalizeMasJournalRows(
  parsed: MasJournalParseResult,
): MasRevenueNormalizationResult {
  const nonTransactionRows = { blank: 0, zeroPlaceholder: 0, cancelled: 0 };
  const transactionRows = parsed.rows.filter((row) => {
    if (row.classification === 'blank') {
      nonTransactionRows.blank += 1;
      return false;
    }
    return true;
  });

  if (transactionRows.length > MAS_REVENUE_LIMITS.maxTransactionRows) {
    throw new MasRevenueError(
      `${transactionRows.length} transaction rows; the limit is ${MAS_REVENUE_LIMITS.maxTransactionRows}`,
    );
  }

  // The same document number twice in one upload blocks every occurrence.
  const documentRows = new Map<string, number[]>();
  for (const row of transactionRows) {
    const document = textOf(row.values.document);
    if (document === null) continue;
    documentRows.set(document, [
      ...(documentRows.get(document) ?? []),
      row.sourceRow,
    ]);
  }

  const receipts: MasRevenueReceipt[] = [];
  const issues: MasRevenueRowIssue[] = [];
  let rejected = 0;

  for (const row of transactionRows) {
    const rowIssues: MasRevenueRowIssue[] = [];
    const issue = (
      field: MasJournalField | null,
      message: string,
      original?: MasRevenueCellValue,
    ) => {
      rowIssues.push({
        sourceSheet: row.sourceSheet,
        sourceRow: row.sourceRow,
        column: field ? MAS_JOURNAL_HEADERS[field][0] : null,
        originalValue:
          original === undefined || original === null
            ? null
            : original instanceof Date
              ? original.toISOString()
              : String(original),
        message,
      });
    };
    const v = row.values;

    for (const field of row.formulaFields) {
      if (CRITICAL_FORMULA_FIELDS.includes(field)) {
        issue(
          field,
          'critical cell is a formula; store the value, not a formula',
          v[field],
        );
      }
    }

    const journalName = textOf(v.journalName);
    if (journalName === null) {
      issue('journalName', 'journal name is required (for example GL Journal)');
    } else if (journalName.length > MAS_JOURNAL_LIMITS.maxJournalNameLength) {
      issue(
        'journalName',
        `journal name is longer than ${MAS_JOURNAL_LIMITS.maxJournalNameLength} characters`,
        v.journalName,
      );
    }

    const document = textOf(v.document);
    if (document === null) {
      issue(
        'document',
        'document number is required: it identifies the entry, so the same entry cannot be uploaded twice',
      );
    } else {
      if (document.length > MAS_JOURNAL_LIMITS.maxDocumentLength) {
        issue(
          'document',
          `document number is longer than ${MAS_JOURNAL_LIMITS.maxDocumentLength} characters`,
          v.document,
        );
      }
      const same = documentRows.get(document) ?? [];
      if (same.length > 1) {
        const others = same.filter((r) => r !== row.sourceRow);
        issue(
          'document',
          `duplicate document number in this upload (also row ${others.join(', ')}); correct or remove one`,
          v.document,
        );
      }
    }

    const date = toIsoDate(v.transactionDate);
    if (!date.ok) issue('transactionDate', date.message, v.transactionDate);

    const accountType = toAccountType(v.accountType);
    if (accountType === null) {
      issue(
        'accountType',
        'ACCOUNTTYPE must be RCash or Ledger',
        v.accountType,
      );
    }
    const offsetAccountType = toAccountType(v.offsetAccountType);
    if (offsetAccountType === null) {
      issue(
        'offsetAccountType',
        'OFFSETACCOUNTTYPE must be RCash or Ledger',
        v.offsetAccountType,
      );
    }
    if (
      accountType !== null &&
      offsetAccountType !== null &&
      accountType === offsetAccountType
    ) {
      issue(
        'offsetAccountType',
        'exactly one side must be RCash (petty cash) and the other Ledger',
        v.offsetAccountType,
      );
    }

    const account = textOf(v.account);
    if (account === null) issue('account', 'ACCOUNTDISPLAYVALUE is required');
    const offsetAccount = textOf(v.offsetAccount);
    if (offsetAccount === null) {
      issue('offsetAccount', 'OFFSETACCOUNTDISPLAYVALUE is required');
    }
    if (accountType !== null && account !== null) {
      checkAccountShape(accountType, account, 'account', v.account, issue);
    }
    if (offsetAccountType !== null && offsetAccount !== null) {
      checkAccountShape(
        offsetAccountType,
        offsetAccount,
        'offsetAccount',
        v.offsetAccount,
        issue,
      );
    }

    const debit = amountOf(v.debit);
    const credit = amountOf(v.credit);
    if (!debit.ok) issue('debit', debit.message, v.debit);
    if (!credit.ok) issue('credit', credit.message, v.credit);
    let side: 'debit' | 'credit' | null = null;
    let minor = 0;
    if (debit.ok && credit.ok) {
      if (debit.minor > 0 && credit.minor > 0) {
        issue(
          'credit',
          'use either DEBITAMOUNT or CREDITAMOUNT on a row, not both',
          v.credit,
        );
      } else if (debit.minor === 0 && credit.minor === 0) {
        issue('debit', 'an amount greater than zero is required', v.debit);
      } else {
        side = debit.minor > 0 ? 'debit' : 'credit';
        minor = debit.minor > 0 ? debit.minor : credit.minor;
      }
    }

    // This upload is Cash In only: a line that takes cash out of petty cash is refused.
    if (
      side !== null &&
      accountType !== null &&
      offsetAccountType !== null &&
      accountType !== offsetAccountType
    ) {
      const cashOut =
        accountType === 'RCash' ? side === 'credit' : side === 'debit';
      if (cashOut) {
        issue(
          side === 'debit' ? 'debit' : 'credit',
          accountType === 'RCash'
            ? 'this upload is Cash In only: a credit on the petty-cash account takes cash out'
            : 'this upload is Cash In only: a debit on the ledger account with petty cash as the offset takes cash out',
          side === 'debit' ? v.debit : v.credit,
        );
      }
    }

    const itemSalesTaxGroup = textOf(v.itemSalesTaxGroup);
    if (itemSalesTaxGroup === null) {
      issue(
        'itemSalesTaxGroup',
        'ITEMSALESTAXGROUP is required (for example Tax 14 or NONTAXABLE)',
      );
    }

    const text = textOf(v.text) ?? '';
    if (text.length > MAS_REVENUE_LIMITS.maxTransactionTextLength) {
      issue(
        'text',
        `text is longer than ${MAS_REVENUE_LIMITS.maxTransactionTextLength} characters`,
        v.text,
      );
    }

    const requestedCurrency = (textOf(v.currency) ?? '').toUpperCase();
    if (requestedCurrency !== '' && !/^[A-Z]{3}$/.test(requestedCurrency)) {
      issue(
        'currency',
        'CURRENCYCODE must be a three-letter code, or empty',
        v.currency,
      );
    }

    if (rowIssues.length > 0) {
      rejected += 1;
      issues.push(...rowIssues);
      continue;
    }

    const line: MasJournalLine = {
      journalName: journalName as string,
      accountType: accountType as MasJournalAccountType,
      account: account as string,
      offsetAccountType: offsetAccountType as MasJournalAccountType,
      offsetAccount: offsetAccount as string,
      side: side as 'debit' | 'credit',
      itemSalesTaxGroup: itemSalesTaxGroup as string,
      salesTaxGroup: textOf(v.salesTaxGroup) ?? '',
      postingProfile: textOf(v.postingProfile) ?? '',
      defaultDimension: textOf(v.defaultDimension) ?? '',
      offsetDefaultDimension: textOf(v.offsetDefaultDimension) ?? '',
      finTag: textOf(v.finTag) ?? '',
      offsetFinTag: textOf(v.offsetFinTag) ?? '',
      text,
      requestedCurrency,
    };

    receipts.push({
      sourceSheet: row.sourceSheet,
      sourceRow: row.sourceRow,
      invoiceNumber: document as string,
      transactionDate: (date as { ok: true; iso: string }).iso,
      currency: '',
      valueMinor: minor,
      vatMinor: 0,
      totalMinor: minor,
      // The D365 petty-cash ID on the row, whichever side it is on.
      cashAccountDisplayName:
        line.accountType === 'RCash' ? line.account : line.offsetAccount,
      customerName: text,
      containerType: null,
      containerNumber: null,
      billOfLading: null,
      revenueType: null,
      seaLine: null,
      vatCardNumber: null,
      journalLine: line,
    });
  }

  return {
    receipts,
    issues,
    nonTransactionRows,
    accounting: {
      transactionRowsRead: transactionRows.length,
      accepted: receipts.length,
      rejected,
    },
  };
}

/** The cash direction of an accepted receipt, for display. */
export function receiptCashEffect(
  receipt: Pick<MasRevenueReceipt, 'journalLine'>,
): 'in' | 'out' | null {
  return receipt.journalLine ? cashEffectOf(receipt.journalLine) : null;
}

function textOf(value: MasRevenueCellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = normalizeSourceText(value);
    return text === '' ? null : text;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

function toAccountType(
  value: MasRevenueCellValue | undefined,
): MasJournalAccountType | null {
  const text = textOf(value);
  if (text === null) return null;
  const key = text.replace(/\s+/g, '').toLowerCase();
  if (key === 'rcash') return 'RCash';
  if (key === 'ledger') return 'Ledger';
  return null;
}

/** An empty amount cell is zero. A negative amount is refused: use the other column. */
function amountOf(
  value: MasRevenueCellValue | undefined,
): { ok: true; minor: number } | { ok: false; message: string } {
  if (value === null || value === undefined || value === '') {
    return { ok: true, minor: 0 };
  }
  const parsed = parseMinor(value);
  if (!parsed.ok) return parsed;
  if (parsed.minor < 0) {
    return {
      ok: false,
      message: 'amount must not be negative; use the other amount column',
    };
  }
  return parsed;
}

function checkAccountShape(
  type: MasJournalAccountType,
  value: string,
  field: 'account' | 'offsetAccount',
  original: MasRevenueCellValue | undefined,
  issue: (
    field: MasJournalField | null,
    message: string,
    original?: MasRevenueCellValue,
  ) => void,
): void {
  if (type === 'RCash') {
    if (value.includes('|')) {
      issue(
        field,
        'a petty-cash account is the cash ID only (for example Port Said), without dimension segments',
        original,
      );
    }
    return;
  }
  const segments = value.split('|').map((segment) => segment.trim());
  if (segments[0] === '') {
    issue(
      field,
      'the ledger account must start with its main account',
      original,
    );
  }
  if (segments.length > MAS_JOURNAL_LIMITS.maxCompositeSegments) {
    issue(
      field,
      `the ledger account has ${segments.length} segments; the limit is ${MAS_JOURNAL_LIMITS.maxCompositeSegments}`,
      original,
    );
  }
}
