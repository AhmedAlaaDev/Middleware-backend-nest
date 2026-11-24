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
    const id = cashAccountIdsByDisplayName[receipt.cashAccountDisplayName];
    if (!id || id.trim() === '') continue;
    byId.set(id, [...(byId.get(id) ?? []), receipt.currency]);
  }
  return byId;
}
