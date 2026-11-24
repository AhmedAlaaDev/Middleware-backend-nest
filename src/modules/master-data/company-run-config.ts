import { BadRequestException } from '@nestjs/common';

import { ILedger } from '@/modules/master-data/interfaces/ledger.interface';

/**
 * Company-specific runtime configuration that processors need for one run.
 *
 * Ownership (see .docs/COMPANY_DATA_OWNERSHIP.md):
 * - Ledger settings (accounting/reporting currency, exchange-rate type, chart of
 *   accounts) belong to the legal entity, so they come from the synced Ledger row.
 * - Exchange-rate rows, main accounts and dimension values are shared by D365FO
 *   and stay shared in local storage. Only the settings above choose which of
 *   them apply to a company.
 *
 * M-P keeps the values the processors have always used (legacy defaults).
 * Other companies must be configured in the ledger: a missing value is an
 * actionable error, never a fallback to M-P's values.
 */
export const LEGACY_COMPANY_CODE = 'm-p';

/** Values the M-P accounting rules have always used. Kept exactly as before. */
export const LEGACY_MP_CURRENCIES = {
  accountingCurrency: 'EGP',
  reportingCurrency: 'USD',
  reportingRateType: 'Default',
} as const;

export interface CompanyRunConfig {
  company: string;
  /** Exchange-rate type for transaction-date rates (Ledger.ExchangeRateType). */
  rateType: string;
  /**
   * Exchange-rate type for reporting-currency rates (Ledger.ReportingCurrencyExchangeRateType).
   * null when the ledger leaves it blank: reporting rates are then missing, not borrowed.
   */
  reportingRateType: string | null;
  /** Chart of accounts used for main-account lookups. */
  chartOfAccounts: string;
  /** Accounting (base) currency of the legal entity. */
  accountingCurrency: string;
  /** Reporting currency of the legal entity. */
  reportingCurrency: string;
  source: 'legacy-m-p' | 'ledger';
}

export interface LegacyRunDefaults {
  rateType: string;
  chartOfAccounts: string;
}

/** Thrown when a non-legacy company lacks the ledger configuration it needs. */
export class CompanyConfigurationError extends BadRequestException {
  constructor(
    public readonly company: string,
    public readonly missing: string[],
    message: string,
  ) {
    super(message);
  }
}

/**
 * Resolves the company's run configuration from its ledger rows.
 * Pure: the caller loads the ledgers (see EntryProcessorBase).
 */
export function resolveCompanyRunConfig(
  company: string,
  ledgers: ILedger[],
  legacy: LegacyRunDefaults,
): CompanyRunConfig {
  if (company === LEGACY_COMPANY_CODE) {
    return {
      company,
      rateType: legacy.rateType,
      reportingRateType: LEGACY_MP_CURRENCIES.reportingRateType,
      chartOfAccounts: legacy.chartOfAccounts,
      accountingCurrency: LEGACY_MP_CURRENCIES.accountingCurrency,
      reportingCurrency: LEGACY_MP_CURRENCIES.reportingCurrency,
      source: 'legacy-m-p',
    };
  }

  const ledger = ledgers.find(
    (row) =>
      String(row.legalEntityId ?? '')
        .trim()
        .toLowerCase() === company.trim().toLowerCase(),
  );

  if (!ledger) {
    throw new CompanyConfigurationError(
      company,
      ['ledger'],
      `No ledger is synced for company "${company}". Sync Ledgers for ${company} in Master Data, then retry.`,
    );
  }

  const missing: string[] = [];
  if (!ledger.accountingCurrency?.trim()) missing.push('accountingCurrency');
  if (!ledger.reportingCurrency?.trim()) missing.push('reportingCurrency');
  if (!ledger.exchangeRateType?.trim()) missing.push('exchangeRateType');
  if (!ledger.chartOfAccounts?.trim()) missing.push('chartOfAccounts');

  if (missing.length > 0) {
    throw new CompanyConfigurationError(
      company,
      missing,
      `Ledger for "${company}" has no ${missing.join(', ')}. Set it in D365FO for ${company}, then run the Ledgers sync.`,
    );
  }

  return {
    company,
    rateType: ledger.exchangeRateType!.trim(),
    reportingRateType: ledger.reportingCurrencyExchangeRateType?.trim() || null,
    chartOfAccounts: ledger.chartOfAccounts!.trim(),
    accountingCurrency: ledger.accountingCurrency.trim().toUpperCase(),
    reportingCurrency: ledger.reportingCurrency.trim().toUpperCase(),
    source: 'ledger',
  };
}

/**
 * Accounting-currency quotation factor for a company's lines.
 *
 * M-P's EGP accounting currency is sent with the scaled factor 100 that D365
 * expects. That is M-P's verified behaviour and stays unchanged. Any other
 * company has no verified factor in code, so an accounting-currency line
 * stops with an actionable error instead of borrowing 100. Returns undefined
 * when the currency is not the company's accounting currency.
 */
export function accountingCurrencyQuotation(
  currency: string,
  run: Pick<CompanyRunConfig, 'company' | 'accountingCurrency' | 'source'>,
): number | undefined {
  const code = currency.trim().toUpperCase();
  if (code === '' || code !== run.accountingCurrency) {
    return undefined;
  }
  if (run.source === 'legacy-m-p') {
    return 100;
  }
  const verified = VERIFIED_ACCOUNTING_QUOTATION_FACTORS[run.company]?.[code];
  if (verified) {
    return verified.factor;
  }
  throw new CompanyConfigurationError(
    run.company,
    ['accountingCurrencyQuotation'],
    `Company "${run.company}" has a ${code} accounting-currency line, but no verified quotation factor is recorded for it. Read the factor from D365FO, record it in VERIFIED_ACCOUNTING_QUOTATION_FACTORS with its evidence, then retry.`,
  );
}

/**
 * Accounting-currency quotation factors verified in D365FO, per company and
 * currency. Each entry names the evidence it was read from. A factor is only
 * listed here after the read; nothing is inferred from another company.
 */
export const VERIFIED_ACCOUNTING_QUOTATION_FACTORS: Readonly<
  Record<string, Readonly<Record<string, { factor: number; evidence: string }>>>
> = {
  mas: {
    EGP: {
      factor: 100,
      evidence:
        'D365FO sandbox, LedgerJournalLines dataAreaId=mas CurrencyCode=EGP (cross-company read, 2026-11-24): 300 of 300 rows store ExchRate=100. The M-P EGP lines use the same factor (ExchRate=100).',
    },
  },
};
