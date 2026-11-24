import { Injectable } from '@nestjs/common';

import { MAS_REVENUE_COMPANY_ID } from './mas-revenue.constants';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

/**
 * Result of checking one configured cash-account ID against D365.
 *   RCASH         exists in CashAccounts for the company (petty cash, posted as RCash)
 *   BANK_ONLY     exists only in BankAccounts; RCash posting would be wrong
 *   UNKNOWN       exists in neither entity for the company
 *   UNVERIFIABLE  the read failed; submission must stay blocked
 */
export type MasRevenueCashAccountStatus =
  | 'RCASH'
  | 'BANK_ONLY'
  | 'UNKNOWN'
  | 'UNVERIFIABLE';

export interface MasRevenueCashAccountCheck {
  id: string;
  status: MasRevenueCashAccountStatus;
  /** CashAccounts currency for RCASH results; null otherwise. */
  currency: string | null;
  /** Failure text for UNVERIFIABLE results. */
  error: string | null;
}

/** Result of checking that a named D365 record exists. A failed read is reported, not assumed. */
export interface MasLiveExistsCheck {
  key: string;
  exists: boolean;
  error: string | null;
}

/** The reporting exchange rate for one date, or why it could not be established. */
export interface MasReportingRateCheck {
  date: string;
  /** Value to send as the line's reporting exchange rate (already scaled by 100). */
  reportingExchangeRate: number | null;
  accountingCurrency: string | null;
  reportingCurrency: string | null;
  error: string | null;
}

function distinctNonEmpty(values: readonly string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter((v) => v !== '')),
  ];
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : 'read failed';
}

interface D365CashAccountRow {
  Cash?: string;
  Currency?: string;
}

interface D365BankAccountRow {
  BankAccountId?: string;
}

/**
 * Read-only check of configured petty-cash IDs against D365, run before a batch is
 * created and again before it is posted. It never writes. A failed read is reported
 * as UNVERIFIABLE, so the gate fails closed rather than assuming the ID is valid.
 */
@Injectable()
export class MasRevenueCashAccountVerifier {
  constructor(
    private readonly d365: D365FOClientService,
    private readonly query: ODataQueryBuilderService,
  ) {}

  public async verify(
    ids: readonly string[],
    company: string = MAS_REVENUE_COMPANY_ID,
  ): Promise<MasRevenueCashAccountCheck[]> {
    const checks: MasRevenueCashAccountCheck[] = [];
    for (const id of [
      ...new Set(
        ids.map((value) => value.trim()).filter((value) => value !== ''),
      ),
    ]) {
      checks.push(await this.checkOne(id, company));
    }
    return checks;
  }

  private async checkOne(
    id: string,
    company: string,
  ): Promise<MasRevenueCashAccountCheck> {
    try {
      const cashRows = await this.readRows<D365CashAccountRow>(
        this.query.buildQuery('/data/CashAccounts', {
          filter: this.query.and(
            this.query.eq('dataAreaId', company),
            this.query.eq('Cash', id),
          ),
          select: ['Cash', 'Currency'],
          top: 5,
          crossCompany: true,
        }),
      );
      const cash = cashRows.find((row) => row.Cash === id);
      if (cash) {
        return {
          id,
          status: 'RCASH',
          currency: cash.Currency ?? null,
          error: null,
        };
      }

      const bankRows = await this.readRows<D365BankAccountRow>(
        this.query.buildQuery('/data/BankAccounts', {
          filter: this.query.and(
            this.query.eq('dataAreaId', company),
            this.query.eq('BankAccountId', id),
          ),
          select: ['BankAccountId'],
          top: 5,
          crossCompany: true,
        }),
      );
      if (bankRows.some((row) => row.BankAccountId === id)) {
        return { id, status: 'BANK_ONLY', currency: null, error: null };
      }
      return { id, status: 'UNKNOWN', currency: null, error: null };
    } catch (error) {
      return {
        id,
        status: 'UNVERIFIABLE',
        currency: null,
        error:
          error instanceof Error ? error.message.slice(0, 200) : 'read failed',
      };
    }
  }

  /**
   * Whether each ledger main account exists in D365. Main accounts are shared across
   * companies (they belong to a chart), so the read is by account ID only. A failed read
   * is reported, never treated as "exists".
   */
  public async verifyMainAccounts(
    ids: readonly string[],
  ): Promise<MasLiveExistsCheck[]> {
    const checks: MasLiveExistsCheck[] = [];
    for (const id of distinctNonEmpty(ids)) {
      try {
        const rows = await this.readRows<{ MainAccountId?: string }>(
          this.query.buildQuery('/data/MainAccounts', {
            filter: this.query.eq('MainAccountId', id),
            select: ['MainAccountId'],
            top: 5,
            crossCompany: true,
          }),
        );
        checks.push({
          key: id,
          exists: rows.some((row) => row.MainAccountId === id),
          error: null,
        });
      } catch (error) {
        checks.push({ key: id, exists: false, error: readError(error) });
      }
    }
    return checks;
  }

  /** Whether each item sales-tax group (TaxItemGroupHeadings) exists for the company. */
  public async verifyItemTaxGroups(
    names: readonly string[],
    company: string = MAS_REVENUE_COMPANY_ID,
  ): Promise<MasLiveExistsCheck[]> {
    const checks: MasLiveExistsCheck[] = [];
    for (const name of distinctNonEmpty(names)) {
      try {
        const rows = await this.readRows<{ TaxItemGroup?: string }>(
          this.query.buildQuery('/data/TaxItemGroupHeadings', {
            filter: this.query.and(
              this.query.eq('dataAreaId', company),
              this.query.eq('TaxItemGroup', name),
            ),
            select: ['TaxItemGroup'],
            top: 5,
            crossCompany: true,
          }),
        );
        checks.push({
          key: name,
          exists: rows.some((row) => row.TaxItemGroup === name),
          error: null,
        });
      } catch (error) {
        checks.push({ key: name, exists: false, error: readError(error) });
      }
    }
    return checks;
  }

  /**
   * The reporting exchange rate D365 puts on a line for each date: 100 divided by the
   * reporting-to-accounting rate valid on that date (for MAS, USD to EGP: 52 gives 1.923
   * and 56.5 gives 1.7699, as on the finance journals). The currencies and the rate type
   * come from the company ledger: its reporting-currency rate type, and when that is blank
   * the ledger's own exchange-rate type (MAS: Average). D365 holds rates of other types for
   * the same date (Global, Budget, Closing, Default); they are not used. A ledger with no
   * rate type, or several rates of that type that disagree for a date, is reported instead
   * of guessed.
   */
  public async readReportingRates(
    dates: readonly string[],
    company: string = MAS_REVENUE_COMPANY_ID,
  ): Promise<MasReportingRateCheck[]> {
    const distinctDates = distinctNonEmpty(dates);
    if (distinctDates.length === 0) return [];
    let ledger: { accounting: string; reporting: string; rateType: string };
    try {
      const rows = await this.readRows<{
        AccountingCurrency?: string;
        ReportingCurrency?: string;
        ReportingCurrencyExchangeRateType?: string;
        ExchangeRateType?: string;
      }>(
        this.query.buildQuery('/data/Ledgers', {
          filter: this.query.eq('LegalEntityId', company.toUpperCase()),
          select: [
            'AccountingCurrency',
            'ReportingCurrency',
            'ReportingCurrencyExchangeRateType',
            'ExchangeRateType',
          ],
          top: 2,
          crossCompany: true,
        }),
      );
      const row = rows[0];
      if (!row?.AccountingCurrency || !row?.ReportingCurrency) {
        throw new Error(
          'the company ledger has no accounting or reporting currency',
        );
      }
      const rateType = (
        row.ReportingCurrencyExchangeRateType?.trim() ||
        row.ExchangeRateType?.trim() ||
        ''
      ).trim();
      if (!rateType) {
        throw new Error(
          'the company ledger names no exchange-rate type (reporting or default)',
        );
      }
      ledger = {
        accounting: row.AccountingCurrency,
        reporting: row.ReportingCurrency,
        rateType,
      };
    } catch (error) {
      return distinctDates.map((date) => ({
        date,
        reportingExchangeRate: null,
        accountingCurrency: null,
        reportingCurrency: null,
        error: readError(error),
      }));
    }

    const checks: MasReportingRateCheck[] = [];
    for (const date of distinctDates) {
      const base = {
        date,
        accountingCurrency: ledger.accounting,
        reportingCurrency: ledger.reporting,
      };
      try {
        const rows = await this.readRows<{
          Rate?: number;
          ConversionFactor?: string;
        }>(
          this.query.buildQuery('/data/ExchangeRates', {
            filter: [
              this.query.eq('FromCurrency', ledger.reporting),
              this.query.eq('ToCurrency', ledger.accounting),
              this.query.eq('RateTypeName', ledger.rateType),
              `StartDate le ${date}T23:59:59Z`,
              `EndDate ge ${date}T00:00:00Z`,
            ].join(' and '),
            select: ['Rate', 'ConversionFactor'],
            top: 20,
            crossCompany: true,
          }),
        );
        const rates = [
          ...new Set(
            rows
              .filter((row) => typeof row.Rate === 'number' && row.Rate > 0)
              .map((row) => row.Rate as number),
          ),
        ];
        if (rates.length === 0) {
          checks.push({
            ...base,
            reportingExchangeRate: null,
            error: `no ${ledger.reporting} to ${ledger.accounting} ${ledger.rateType} exchange rate is valid on ${date}`,
          });
        } else if (rates.length > 1) {
          checks.push({
            ...base,
            reportingExchangeRate: null,
            error: `the ${ledger.reporting} to ${ledger.accounting} ${ledger.rateType} rates valid on ${date} disagree (${rates.join(', ')}); not guessed`,
          });
        } else if (
          rows.some(
            (row) => row.ConversionFactor && row.ConversionFactor !== 'One',
          )
        ) {
          checks.push({
            ...base,
            reportingExchangeRate: null,
            error: `the ${ledger.reporting} to ${ledger.accounting} rate on ${date} has a conversion factor other than One; its scale is not verified`,
          });
        } else {
          checks.push({
            ...base,
            reportingExchangeRate: 100 / rates[0],
            error: null,
          });
        }
      } catch (error) {
        checks.push({
          ...base,
          reportingExchangeRate: null,
          error: readError(error),
        });
      }
    }
    return checks;
  }

  private async readRows<T>(endpoint: string): Promise<T[]> {
    const response = await this.d365.get<T>(endpoint, { useCache: false });
    return response.value ?? [];
  }
}

/** Blocker messages for the cash-account checks. An empty list means every check passed. */
export function masRevenueCashAccountBlockers(
  checks: readonly MasRevenueCashAccountCheck[],
  receiptCurrencyById: ReadonlyMap<string, readonly string[]>,
): string[] {
  const blockers: string[] = [];
  for (const check of checks) {
    switch (check.status) {
      case 'RCASH': {
        const currencies = receiptCurrencyById.get(check.id) ?? [];
        const mismatched = currencies.filter(
          (currency) => currency !== check.currency,
        );
        if (mismatched.length > 0) {
          blockers.push(
            `cash account "${check.id}" is in ${check.currency ?? 'an unknown currency'} in D365; ` +
              `receipts in ${[...new Set(mismatched)].join(', ')} cannot be posted to it`,
          );
        }
        break;
      }
      case 'BANK_ONLY':
        blockers.push(
          `configured account "${check.id}" is a bank account in D365. RCash posting is not supported for bank ` +
            'accounts, so it is blocked until the bank path is implemented and verified.',
        );
        break;
      case 'UNKNOWN':
        blockers.push(
          `configured cash account "${check.id}" does not exist in CashAccounts for company ${MAS_REVENUE_COMPANY_ID} in D365.`,
        );
        break;
      case 'UNVERIFIABLE':
        blockers.push(
          `cash-account verification failed for "${check.id}" (D365 lookup error: ${check.error ?? 'read failed'}). ` +
            'This is a lookup failure, not an unknown account; submission is blocked until the check succeeds.',
        );
        break;
    }
  }
  return blockers;
}

/**
 * Currencies of the receipts that post to each configured cash ID. A receipt whose
 * cash name has no configured ID contributes nothing here; the configuration gate
 * already reports that name.
 */
export function receiptCurrenciesByCashId(
  cashAccountIdsByDisplayName: Readonly<Record<string, string>>,
  receipts: ReadonlyArray<{ cashAccountDisplayName: string; currency: string }>,
): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const receipt of receipts) {
    // A receipt without a resolved currency is reported by the currency blocker, not here.
    if (!receipt.currency) continue;
    const id = cashAccountIdsByDisplayName[receipt.cashAccountDisplayName];
    if (!id || id.trim() === '') continue;
    byId.set(id, [...(byId.get(id) ?? []), receipt.currency]);
  }
  return byId;
}
