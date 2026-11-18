import {
  evaluateBankAccountRows,
  evaluateCashAccountRows,
  offsetAccountTypeForPaymentType,
  YardInvoiceAccountResolver,
} from './yard-invoice-account.resolver';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

const ACTIVE_BANK = {
  BankAccountId: 'Yard Bank',
  CurrencyCode: 'EGP',
  BankAccountStatus: 'ActiveForAllTransactions',
  ActiveFrom: '1900-01-01T00:00:00Z',
  ActiveTo: '2154-01-01T00:00:00Z',
};

describe('offsetAccountTypeForPaymentType', () => {
  it('maps Cash to Petty cash and the bank-type methods to Bank', () => {
    expect(offsetAccountTypeForPaymentType('Cash')).toBe('Petty cash');
    expect(offsetAccountTypeForPaymentType('Cheque')).toBe('Bank');
    expect(offsetAccountTypeForPaymentType('Transfer')).toBe('Bank');
    expect(offsetAccountTypeForPaymentType('Deposit')).toBe('Bank');
    expect(offsetAccountTypeForPaymentType('Visa')).toBeNull();
  });
});

describe('evaluateBankAccountRows', () => {
  const base = {
    safeBankAccount: ' Yard Bank ',
    currencyCode: 'EGP',
    paymentDate: '2026-07-15',
  };

  it('accepts an active account in the payment currency and date window', () => {
    const r = evaluateBankAccountRows({ ...base, rows: [ACTIVE_BANK] });
    expect(r).toMatchObject({
      status: 'OK',
      accountType: 'Bank',
      accountDisplayValue: 'Yard Bank',
    });
  });

  it('rejects a missing account (no alias or substitution)', () => {
    expect(evaluateBankAccountRows({ ...base, rows: [] }).status).toBe(
      'NOT_FOUND',
    );
  });

  it('rejects an ambiguous match', () => {
    expect(
      evaluateBankAccountRows({ ...base, rows: [ACTIVE_BANK, ACTIVE_BANK] })
        .status,
    ).toBe('AMBIGUOUS');
  });

  it('rejects an inactive account (numeric and named statuses)', () => {
    expect(
      evaluateBankAccountRows({
        ...base,
        rows: [
          { ...ACTIVE_BANK, BankAccountStatus: 'InactiveForAllTransactions' },
        ],
      }).status,
    ).toBe('INACTIVE');
    expect(
      evaluateBankAccountRows({
        ...base,
        rows: [{ ...ACTIVE_BANK, BankAccountStatus: 2 }],
      }).status,
    ).toBe('INACTIVE');
    expect(
      evaluateBankAccountRows({
        ...base,
        rows: [{ ...ACTIVE_BANK, BankAccountStatus: 0 }],
      }).status,
    ).toBe('OK');
  });

  it('rejects an account whose window does not cover the payment date', () => {
    const r = evaluateBankAccountRows({
      ...base,
      rows: [{ ...ACTIVE_BANK, ActiveTo: '2026-06-30T00:00:00Z' }],
    });
    expect(r.status).toBe('NOT_ACTIVE_ON_DATE');
  });

  it('rejects a currency mismatch and an account with no currency', () => {
    expect(
      evaluateBankAccountRows({
        ...base,
        rows: [{ ...ACTIVE_BANK, CurrencyCode: 'USD' }],
      }).status,
    ).toBe('CURRENCY_MISMATCH');
    expect(
      evaluateBankAccountRows({
        ...base,
        rows: [{ ...ACTIVE_BANK, CurrencyCode: '' }],
      }).status,
    ).toBe('CURRENCY_UNKNOWN');
  });

  it('rejects an empty safe value', () => {
    expect(
      evaluateBankAccountRows({
        ...base,
        safeBankAccount: '  ',
        rows: [ACTIVE_BANK],
      }).status,
    ).toBe('NOT_FOUND');
  });
});

describe('evaluateCashAccountRows', () => {
  it('accepts a petty-cash account in the payment currency and rejects others', () => {
    const base = { safeBankAccount: 'Yard Cash', currencyCode: 'EGP' };
    expect(
      evaluateCashAccountRows({
        ...base,
        rows: [{ Cash: 'Yard Cash', Currency: 'EGP' }],
      }),
    ).toMatchObject({
      status: 'OK',
      accountType: 'Petty cash',
    });
    expect(
      evaluateCashAccountRows({
        ...base,
        rows: [{ Cash: 'Yard Cash', Currency: 'USD' }],
      }).status,
    ).toBe('CURRENCY_MISMATCH');
    expect(evaluateCashAccountRows({ ...base, rows: [] }).status).toBe(
      'NOT_FOUND',
    );
  });
});

describe('YardInvoiceAccountResolver', () => {
  function resolverWith(get: jest.Mock) {
    const d365 = { get } as unknown as D365FOClientService;
    return new YardInvoiceAccountResolver(d365, new ODataQueryBuilderService());
  }

  it('reads BankAccounts for Bank payment types, scoped to the company', async () => {
    const get = jest.fn().mockResolvedValue({ value: [ACTIVE_BANK] });
    const result = await resolverWith(get).resolve({
      company: 'm-p',
      paymentType: 'Transfer',
      safeBankAccount: 'Yard Bank',
      paymentDate: '2026-07-15',
      currencyCode: 'EGP',
    });
    expect(result.status).toBe('OK');
    const endpoint = String(get.mock.calls[0][0]);
    expect(endpoint).toContain('/data/BankAccounts');
    expect(endpoint).toContain('dataAreaId');
    expect(endpoint).toContain('BankAccountId');
  });

  it('reads CashAccounts for Cash payments', async () => {
    const get = jest
      .fn()
      .mockResolvedValue({ value: [{ Cash: 'Yard Cash', Currency: 'EGP' }] });
    const result = await resolverWith(get).resolve({
      company: 'm-p',
      paymentType: 'Cash',
      safeBankAccount: 'Yard Cash',
      paymentDate: '2026-07-15',
      currencyCode: 'EGP',
    });
    expect(result).toMatchObject({ status: 'OK', accountType: 'Petty cash' });
    expect(String(get.mock.calls[0][0])).toContain('/data/CashAccounts');
  });

  it('returns LOOKUP_FAILED as retryable when D365 cannot be read', async () => {
    const get = jest.fn().mockRejectedValue(new Error('503'));
    const result = await resolverWith(get).resolve({
      company: 'm-p',
      paymentType: 'Cheque',
      safeBankAccount: 'Yard Bank',
      paymentDate: '2026-07-15',
      currencyCode: 'EGP',
    });
    expect(result).toMatchObject({ status: 'LOOKUP_FAILED', retryable: true });
  });

  it('rejects an unsupported payment type without calling D365', async () => {
    const get = jest.fn();
    const result = await resolverWith(get).resolve({
      company: 'm-p',
      paymentType: 'Visa',
      safeBankAccount: 'x',
      paymentDate: '2026-07-15',
      currencyCode: 'EGP',
    });
    expect(result.status).toBe('UNSUPPORTED_PAYMENT_TYPE');
    expect(get).not.toHaveBeenCalled();
  });
});
