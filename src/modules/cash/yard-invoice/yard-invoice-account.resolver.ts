import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

/**
 * Offset account for a Yard receipt. The template SAFE_BankAccount value is
 * the offset account display value. It must be a real D365 account of the
 * type the payment method requires, in the request company. Nothing is
 * aliased or substituted.
 *
 * Payment method -> OFFSETACCOUNTTYPE (reference generator; matches the
 * EntryAccountType spellings used by the Cash-In processors):
 *   Cash                      -> 'Petty cash' (D365 CashAccounts)
 *   Cheque / Check / Transfer / Deposit -> 'Bank' (D365 BankAccounts)
 */
export type YardOffsetAccountType = 'Petty cash' | 'Bank';

export type YardOffsetAccountStatus =
  | 'OK'
  | 'NOT_FOUND'
  | 'AMBIGUOUS'
  | 'INACTIVE'
  | 'NOT_ACTIVE_ON_DATE'
  | 'CURRENCY_MISMATCH'
  | 'CURRENCY_UNKNOWN'
  | 'UNSUPPORTED_PAYMENT_TYPE'
  | 'LOOKUP_FAILED';

export interface YardOffsetAccountResolution {
  status: YardOffsetAccountStatus;
  accountType: YardOffsetAccountType | null;
  /** Trimmed safe value, used as OFFSETACCOUNTDISPLAYVALUE only when OK. */
  accountDisplayValue: string;
  message: string;
  retryable: boolean;
}

export interface D365BankAccountRow {
  BankAccountId?: string;
  CurrencyCode?: string;
  BankAccountStatus?: string | number;
  ActiveFrom?: string | null;
  ActiveTo?: string | null;
}

export interface D365CashAccountRow {
  Cash?: string;
  Currency?: string;
}

/** Key used to look up a batch-resolved offset account result. */
export function offsetRequestKey(request: {
  paymentType: string;
  safeBankAccount: string;
  paymentDate: string;
  currencyCode: string;
}): string {
  return [
    request.paymentType,
    request.safeBankAccount.trim(),
    request.currencyCode,
    request.paymentDate,
  ].join('|');
}

export function offsetAccountTypeForPaymentType(
  paymentType: string,
): YardOffsetAccountType | null {
  switch (paymentType) {
    case 'Cash':
      return 'Petty cash';
    case 'Cheque':
    case 'Transfer':
    case 'Deposit':
      return 'Bank';
    default:
      return null;
  }
}

const ACTIVE_STATUS_NAMES = new Set(['activeforalltransactions', '0']);

/** Pure decision over the rows returned for one bank account id. */
export function evaluateBankAccountRows(input: {
  rows: D365BankAccountRow[];
  safeBankAccount: string;
  currencyCode: string;
  paymentDate: string;
}): YardOffsetAccountResolution {
  return decide('Bank', input.safeBankAccount, input.rows, (row) => {
    const status = String(row.BankAccountStatus ?? '')
      .trim()
      .toLowerCase();
    if (!ACTIVE_STATUS_NAMES.has(status)) {
      return [
        'INACTIVE',
        'bank account is not active for all transactions in D365',
      ];
    }
    if (!isDateWithin(input.paymentDate, row.ActiveFrom, row.ActiveTo)) {
      return [
        'NOT_ACTIVE_ON_DATE',
        `bank account is not active on ${input.paymentDate}`,
      ];
    }
    return currencyDecision(row.CurrencyCode, input.currencyCode);
  });
}

/** Pure decision over the rows returned for one petty-cash account id. */
export function evaluateCashAccountRows(input: {
  rows: D365CashAccountRow[];
  safeBankAccount: string;
  currencyCode: string;
}): YardOffsetAccountResolution {
  return decide('Petty cash', input.safeBankAccount, input.rows, (row) =>
    currencyDecision(row.Currency, input.currencyCode),
  );
}

function decide<T>(
  accountType: YardOffsetAccountType,
  safe: string,
  rows: T[],
  check: (row: T) => [YardOffsetAccountStatus, string] | null,
): YardOffsetAccountResolution {
  const accountDisplayValue = safe.trim();
  const fail = (status: YardOffsetAccountStatus, message: string) => ({
    status,
    accountType,
    accountDisplayValue,
    message,
    retryable: status === 'LOOKUP_FAILED',
  });
  if (!accountDisplayValue) {
    return fail('NOT_FOUND', 'SAFE_BankAccount is empty');
  }
  if (rows.length === 0) {
    return fail(
      'NOT_FOUND',
      `${accountType} account "${accountDisplayValue}" does not exist in the company`,
    );
  }
  if (rows.length > 1) {
    return fail(
      'AMBIGUOUS',
      `${accountType} account "${accountDisplayValue}" matches ${rows.length} records`,
    );
  }
  const result = check(rows[0]);
  if (result) {
    return fail(
      result[0],
      `${accountType} account "${accountDisplayValue}": ${result[1]}`,
    );
  }
  return {
    status: 'OK',
    accountType,
    accountDisplayValue,
    message: '',
    retryable: false,
  };
}

function currencyDecision(
  accountCurrency: string | undefined,
  currencyCode: string,
): [YardOffsetAccountStatus, string] | null {
  const account = String(accountCurrency ?? '')
    .trim()
    .toUpperCase();
  if (!account) {
    return [
      'CURRENCY_UNKNOWN',
      'account has no currency in D365; currency cannot be verified',
    ];
  }
  if (account !== currencyCode.trim().toUpperCase()) {
    return [
      'CURRENCY_MISMATCH',
      `account currency ${account} differs from payment currency ${currencyCode}`,
    ];
  }
  return null;
}

/** Sentinel dates (1900 / 2154-style) mean "no bound". */
function isDateWithin(
  date: string,
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  const day = date.slice(0, 10);
  const lower = yearOf(from) >= 1901 ? (from ?? '').slice(0, 10) : '';
  const upper =
    yearOf(to) > 0 && yearOf(to) <= 2100 ? (to ?? '').slice(0, 10) : '';
  if (lower && day < lower) return false;
  if (upper && day > upper) return false;
  return true;
}

function yearOf(value: string | null | undefined): number {
  const year = Number(String(value ?? '').slice(0, 4));
  return Number.isFinite(year) ? year : 0;
}

@Injectable()
export class YardInvoiceAccountResolver {
  private readonly logger = new Logger(YardInvoiceAccountResolver.name);

  constructor(
    private readonly d365: D365FOClientService,
    private readonly query: ODataQueryBuilderService,
  ) {}

  /**
   * Reads the account for one receipt from its authoritative D365 entity:
   * BankAccounts (key dataAreaId + BankAccountId) for Bank, CashAccounts
   * (key dataAreaId + Cash) for Petty cash. Read-only.
   */
  public async resolve(input: {
    company: string;
    paymentType: string;
    safeBankAccount: string;
    paymentDate: string;
    currencyCode: string;
  }): Promise<YardOffsetAccountResolution> {
    const accountType = offsetAccountTypeForPaymentType(input.paymentType);
    const safe = input.safeBankAccount.trim();
    if (!accountType) {
      return {
        status: 'UNSUPPORTED_PAYMENT_TYPE',
        accountType: null,
        accountDisplayValue: safe,
        message: `payment type "${input.paymentType}" has no offset account rule`,
        retryable: false,
      };
    }
    try {
      if (accountType === 'Bank') {
        const rows = await this.readAll<D365BankAccountRow>(
          this.query.buildQuery('/data/BankAccounts', {
            filter: this.query.and(
              this.query.eq('dataAreaId', input.company),
              this.query.eq('BankAccountId', safe),
            ),
            select: [
              'BankAccountId',
              'CurrencyCode',
              'BankAccountStatus',
              'ActiveFrom',
              'ActiveTo',
            ],
            top: 5,
            crossCompany: true,
          }),
        );
        return evaluateBankAccountRows({
          rows,
          safeBankAccount: safe,
          currencyCode: input.currencyCode,
          paymentDate: input.paymentDate,
        });
      }
      const rows = await this.readAll<D365CashAccountRow>(
        this.query.buildQuery('/data/CashAccounts', {
          filter: this.query.and(
            this.query.eq('dataAreaId', input.company),
            this.query.eq('Cash', safe),
          ),
          select: ['Cash', 'Currency'],
          top: 5,
          crossCompany: true,
        }),
      );
      return evaluateCashAccountRows({
        rows,
        safeBankAccount: safe,
        currencyCode: input.currencyCode,
      });
    } catch (error) {
      this.logger.warn(
        `Offset account lookup failed (company ${input.company}): ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return {
        status: 'LOOKUP_FAILED',
        accountType,
        accountDisplayValue: safe,
        message: 'D365 account read failed; retry the review',
        retryable: true,
      };
    }
  }

  /**
   * Resolves many payments with one D365 read per distinct (account type, safe)
   * pair. The rows are cached for the batch, then each payment is evaluated
   * against them for its currency and date. Read-only.
   */
  public async resolveMany(
    company: string,
    requests: {
      paymentType: string;
      safeBankAccount: string;
      paymentDate: string;
      currencyCode: string;
    }[],
  ): Promise<Map<string, YardOffsetAccountResolution>> {
    const cache = new Map<
      string,
      D365BankAccountRow[] | D365CashAccountRow[] | Error
    >();
    const out = new Map<string, YardOffsetAccountResolution>();
    for (const request of requests) {
      const key = offsetRequestKey(request);
      if (out.has(key)) continue;
      const accountType = offsetAccountTypeForPaymentType(request.paymentType);
      const safe = request.safeBankAccount.trim();
      if (!accountType) {
        out.set(key, {
          status: 'UNSUPPORTED_PAYMENT_TYPE',
          accountType: null,
          accountDisplayValue: safe,
          message: `payment type "${request.paymentType}" has no offset account rule`,
          retryable: false,
        });
        continue;
      }
      const cacheKey = `${accountType}|${safe}`;
      if (!cache.has(cacheKey)) {
        try {
          cache.set(
            cacheKey,
            await this.readAccountRows(company, accountType, safe),
          );
        } catch (error) {
          this.logger.warn(
            `Offset account lookup failed (company ${company}): ${error instanceof Error ? error.name : 'unknown error'}`,
          );
          cache.set(
            cacheKey,
            error instanceof Error ? error : new Error('lookup failed'),
          );
        }
      }
      const rows = cache.get(cacheKey) as
        | D365BankAccountRow[]
        | D365CashAccountRow[]
        | Error;
      if (rows instanceof Error) {
        out.set(key, {
          status: 'LOOKUP_FAILED',
          accountType,
          accountDisplayValue: safe,
          message: 'D365 account read failed; retry the review',
          retryable: true,
        });
        continue;
      }
      out.set(
        key,
        accountType === 'Bank'
          ? evaluateBankAccountRows({
              rows: rows as D365BankAccountRow[],
              safeBankAccount: safe,
              currencyCode: request.currencyCode,
              paymentDate: request.paymentDate,
            })
          : evaluateCashAccountRows({
              rows: rows as D365CashAccountRow[],
              safeBankAccount: safe,
              currencyCode: request.currencyCode,
            }),
      );
    }
    return out;
  }

  /** Raw D365 rows for one account id: BankAccounts for Bank, CashAccounts for Petty cash. */
  private async readAccountRows(
    company: string,
    accountType: YardOffsetAccountType,
    safe: string,
  ): Promise<D365BankAccountRow[] | D365CashAccountRow[]> {
    if (accountType === 'Bank') {
      return this.readAll<D365BankAccountRow>(
        this.query.buildQuery('/data/BankAccounts', {
          filter: this.query.and(
            this.query.eq('dataAreaId', company),
            this.query.eq('BankAccountId', safe),
          ),
          select: [
            'BankAccountId',
            'CurrencyCode',
            'BankAccountStatus',
            'ActiveFrom',
            'ActiveTo',
          ],
          top: 5,
          crossCompany: true,
        }),
      );
    }
    return this.readAll<D365CashAccountRow>(
      this.query.buildQuery('/data/CashAccounts', {
        filter: this.query.and(
          this.query.eq('dataAreaId', company),
          this.query.eq('Cash', safe),
        ),
        select: ['Cash', 'Currency'],
        top: 5,
        crossCompany: true,
      }),
    );
  }

  private async readAll<T>(endpoint: string): Promise<T[]> {
    const response = await this.d365.get<T>(endpoint, { useCache: false });
    return response.value ?? [];
  }
}
