import {
  cashAccountIdOf,
  cashEffectOf,
  ledgerAccountOf,
} from './mas-journal-line';
import { MAS_REVENUE_COMPANY_ID } from './mas-revenue.constants';

import type {
  MasLiveExistsCheck,
  MasReportingRateCheck,
  MasRevenueCashAccountCheck,
  MasRevenueCashAccountVerifier,
} from './mas-revenue-cash-account-verifier';
import type { MasRevenueVerifiedConfig } from './mas-revenue-config';
import type { MasRevenueReceipt } from './mas-revenue.types';

import { VERIFIED_ACCOUNTING_QUOTATION_FACTORS } from '@/modules/master-data/company-run-config';

/**
 * What a template version 2 upload needs from D365, read live (never configured):
 * its ledger main accounts, its item tax groups and the reporting rate on each date.
 * The petty-cash accounts are checked separately by the cash-account verifier.
 */
export interface MasJournalLiveChecks {
  mainAccounts: MasLiveExistsCheck[];
  itemTaxGroups: MasLiveExistsCheck[];
  reportingRates: MasReportingRateCheck[];
}

export const EMPTY_MAS_JOURNAL_LIVE_CHECKS: MasJournalLiveChecks = {
  mainAccounts: [],
  itemTaxGroups: [],
  reportingRates: [],
};

/** The main account of a ledger composite: its first segment. */
export function mainAccountOf(composite: string): string {
  return composite.split('|')[0].trim();
}

type JournalReceipt = MasRevenueReceipt & {
  journalLine: NonNullable<MasRevenueReceipt['journalLine']>;
};

function journalReceipts(
  receipts: readonly MasRevenueReceipt[],
): JournalReceipt[] {
  return receipts.filter(
    (receipt): receipt is JournalReceipt => receipt.journalLine !== undefined,
  );
}

/** Reads, from D365, what the rows reference. Every read is a GET. */
export async function collectMasJournalLiveChecks(
  verifier: MasRevenueCashAccountVerifier,
  receipts: readonly MasRevenueReceipt[],
): Promise<MasJournalLiveChecks> {
  const rows = journalReceipts(receipts);
  const [mainAccounts, itemTaxGroups, reportingRates] = await Promise.all([
    verifier.verifyMainAccounts(
      rows.map((row) => mainAccountOf(ledgerAccountOf(row.journalLine))),
    ),
    verifier.verifyItemTaxGroups(
      rows.map((row) => row.journalLine.itemSalesTaxGroup),
    ),
    verifier.readReportingRates(rows.map((row) => row.transactionDate)),
  ]);
  return { mainAccounts, itemTaxGroups, reportingRates };
}

/**
 * The accounting exchange rate (D365 percent scale) verified for the company's accounting
 * currency, or undefined when none is recorded. Only evidence-backed factors are used.
 */
export function accountingExchangeRateFor(
  currency: string,
  company: string = MAS_REVENUE_COMPANY_ID,
): number | undefined {
  return VERIFIED_ACCOUNTING_QUOTATION_FACTORS[company]?.[currency]?.factor;
}

function rowsText(rows: number[]): string {
  const shown = rows.slice(0, 5).join(', ');
  return rows.length > 5 ? `${shown} and ${rows.length - 5} more` : shown;
}

/**
 * Why a template version 2 upload cannot be posted yet. Nothing here is configuration
 * about the entries themselves: each reason is either something D365 says is missing, or
 * the one environment check that only a sandbox test can settle.
 */
export function getMasJournalBlockers(input: {
  config: MasRevenueVerifiedConfig;
  receipts: readonly MasRevenueReceipt[];
  cashChecks: readonly MasRevenueCashAccountCheck[];
  live: MasJournalLiveChecks;
}): string[] {
  const { config, receipts, cashChecks, live } = input;
  const rows = journalReceipts(receipts);
  const blockers: string[] = [];

  if (receipts.length === 0) {
    blockers.push('there are no accepted receipts to submit');
  }

  // Petty-cash accounts: must exist as RCash accounts in D365 and have a currency.
  const cashRows = new Map<string, number[]>();
  for (const row of rows) {
    const id = cashAccountIdOf(row.journalLine);
    cashRows.set(id, [...(cashRows.get(id) ?? []), row.sourceRow]);
  }
  for (const [id, sourceRows] of cashRows) {
    const check = cashChecks.find((candidate) => candidate.id === id);
    const where = `(row ${rowsText(sourceRows)})`;
    if (!check) {
      blockers.push(`cash account "${id}" was not checked in D365 ${where}`);
    } else if (check.status === 'BANK_ONLY') {
      blockers.push(
        `cash account "${id}" is a bank account in D365; this upload posts petty cash (RCash) only ${where}`,
      );
    } else if (check.status === 'UNKNOWN') {
      blockers.push(
        `cash account "${id}" does not exist in D365 CashAccounts for company ${MAS_REVENUE_COMPANY_ID} ${where}`,
      );
    } else if (check.status === 'UNVERIFIABLE') {
      blockers.push(
        `cash account "${id}" could not be verified in D365 (${check.error ?? 'read failed'}); not treated as valid ${where}`,
      );
    } else if (!check.currency) {
      blockers.push(`cash account "${id}" has no currency in D365 ${where}`);
    }
  }

  // The currency is the cash account's. A CURRENCYCODE in the file must agree with it.
  for (const row of rows) {
    const requested = row.journalLine.requestedCurrency;
    if (row.currency && requested && requested !== row.currency) {
      blockers.push(
        `row ${row.sourceRow}: CURRENCYCODE ${requested} differs from the D365 currency ${row.currency} of cash account "${cashAccountIdOf(row.journalLine)}"`,
      );
    }
  }

  // Accounting exchange rate: only an evidence-backed factor is used.
  for (const currency of new Set(
    rows.map((row) => row.currency).filter(Boolean),
  )) {
    if (accountingExchangeRateFor(currency) === undefined) {
      blockers.push(
        `currency ${currency}: no verified accounting exchange rate is recorded for ${MAS_REVENUE_COMPANY_ID.toUpperCase()}`,
      );
    }
  }

  // Ledger main accounts and item tax groups must exist in D365.
  const missing = (
    label: string,
    keyOf: (row: JournalReceipt) => string,
    checks: readonly MasLiveExistsCheck[],
  ) => {
    const byKey = new Map<string, number[]>();
    for (const row of rows) {
      const key = keyOf(row);
      byKey.set(key, [...(byKey.get(key) ?? []), row.sourceRow]);
    }
    for (const [key, sourceRows] of byKey) {
      const check = checks.find((candidate) => candidate.key === key);
      const where = `(row ${rowsText(sourceRows)})`;
      if (!check) {
        blockers.push(`${label} "${key}" was not checked in D365 ${where}`);
      } else if (check.error) {
        blockers.push(
          `${label} "${key}" could not be verified in D365 (${check.error}); not treated as valid ${where}`,
        );
      } else if (!check.exists) {
        blockers.push(`${label} "${key}" does not exist in D365 ${where}`);
      }
    }
  };
  missing(
    'ledger main account',
    (row) => mainAccountOf(ledgerAccountOf(row.journalLine)),
    live.mainAccounts,
  );
  missing(
    'item sales-tax group',
    (row) => row.journalLine.itemSalesTaxGroup,
    live.itemTaxGroups,
  );

  // Reporting rate on each transaction date.
  for (const date of new Set(rows.map((row) => row.transactionDate))) {
    const check = live.reportingRates.find(
      (candidate) => candidate.date === date,
    );
    if (!check) {
      blockers.push(
        `reporting exchange rate for ${date} was not read from D365`,
      );
    } else if (check.error || check.reportingExchangeRate === null) {
      blockers.push(
        `reporting exchange rate for ${date}: ${check.error ?? 'not available'}`,
      );
    }
  }

  // The two environment checks that only a sandbox posting can settle.
  if (!config.deployedCompatibility.lineServiceVerifiedForGl) {
    blockers.push(
      'the cash-in line service has not been verified for these journal lines on a GL journal in this environment',
    );
  }
  if (!config.deployedCompatibility.glReadbackVerified) {
    blockers.push(
      'GL journal readback has not been verified in this environment',
    );
  }
  return blockers;
}

/** Direction label for the review. */
export function receiptDirection(
  receipt: MasRevenueReceipt,
): 'in' | 'out' | null {
  return receipt.journalLine ? cashEffectOf(receipt.journalLine) : null;
}
