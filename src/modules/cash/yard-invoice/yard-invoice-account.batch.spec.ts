import {
  offsetRequestKey,
  YardInvoiceAccountResolver,
} from './yard-invoice-account.resolver';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

const BANK_ACTIVE = {
  BankAccountId: 'QNB-EG-CA1',
  CurrencyCode: 'EGP',
  BankAccountStatus: 'ActiveForAllTransactions',
  ActiveFrom: '1900-01-01T00:00:00Z',
  ActiveTo: '2154-01-01T00:00:00Z',
};

describe('YardInvoiceAccountResolver.resolveMany', () => {
  function resolverWith(get: jest.Mock) {
    return new YardInvoiceAccountResolver(
      { get } as unknown as D365FOClientService,
      new ODataQueryBuilderService(),
    );
  }

  it('reads each distinct account once, however many payments use it', async () => {
    const get = jest.fn((endpoint: string) =>
      Promise.resolve({
        value: endpoint.includes('/data/BankAccounts') ? [BANK_ACTIVE] : [],
      }),
    );
    const requests = Array.from({ length: 500 }, (_, i) => ({
      paymentType: 'Transfer',
      safeBankAccount: 'QNB-EG-CA1',
      paymentDate: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
      currencyCode: 'EGP',
    }));
    const results = await resolverWith(get).resolveMany('m-p', requests);
    expect(get).toHaveBeenCalledTimes(1);
    expect(results.get(offsetRequestKey(requests[0]))).toMatchObject({
      status: 'OK',
      accountType: 'Bank',
    });
  });

  it('evaluates each payment against the cached rows for its own currency and date', async () => {
    const get = jest.fn(() => Promise.resolve({ value: [BANK_ACTIVE] }));
    const results = await resolverWith(get).resolveMany('m-p', [
      {
        paymentType: 'Transfer',
        safeBankAccount: 'QNB-EG-CA1',
        paymentDate: '2026-07-15',
        currencyCode: 'EGP',
      },
      {
        paymentType: 'Transfer',
        safeBankAccount: 'QNB-EG-CA1',
        paymentDate: '2026-07-15',
        currencyCode: 'USD',
      },
    ]);
    expect(get).toHaveBeenCalledTimes(1);
    const egp = results.get(
      offsetRequestKey({
        paymentType: 'Transfer',
        safeBankAccount: 'QNB-EG-CA1',
        paymentDate: '2026-07-15',
        currencyCode: 'EGP',
      }),
    );
    const usd = results.get(
      offsetRequestKey({
        paymentType: 'Transfer',
        safeBankAccount: 'QNB-EG-CA1',
        paymentDate: '2026-07-15',
        currencyCode: 'USD',
      }),
    );
    expect(egp?.status).toBe('OK');
    expect(usd?.status).toBe('CURRENCY_MISMATCH');
  });

  it('reads petty-cash accounts from CashAccounts for Cash payments', async () => {
    const get = jest.fn((endpoint: string) =>
      Promise.resolve({
        value: endpoint.includes('/data/CashAccounts')
          ? [{ Cash: 'Yard EG', Currency: 'EGP' }]
          : [],
      }),
    );
    const request = {
      paymentType: 'Cash',
      safeBankAccount: 'Yard EG',
      paymentDate: '2026-07-15',
      currencyCode: 'EGP',
    };
    const results = await resolverWith(get).resolveMany('m-p', [request]);
    expect(results.get(offsetRequestKey(request))).toMatchObject({
      status: 'OK',
      accountType: 'Petty cash',
    });
    expect(String(get.mock.calls[0][0])).toContain('/data/CashAccounts');
  });

  it('marks a failed account read as LOOKUP_FAILED (retryable) for its payments only', async () => {
    const get = jest.fn((endpoint: string) =>
      endpoint.includes('CIB-EG-CA')
        ? Promise.reject(new Error('503'))
        : Promise.resolve({ value: [BANK_ACTIVE] }),
    );
    const bad = {
      paymentType: 'Deposit',
      safeBankAccount: 'CIB-EG-CA',
      paymentDate: '2026-07-15',
      currencyCode: 'EGP',
    };
    const good = {
      paymentType: 'Transfer',
      safeBankAccount: 'QNB-EG-CA1',
      paymentDate: '2026-07-15',
      currencyCode: 'EGP',
    };
    const results = await resolverWith(get).resolveMany('m-p', [bad, good]);
    expect(results.get(offsetRequestKey(bad))).toMatchObject({
      status: 'LOOKUP_FAILED',
      retryable: true,
    });
    expect(results.get(offsetRequestKey(good))?.status).toBe('OK');
  });

  it('refuses an unsupported payment type without any D365 call', async () => {
    const get = jest.fn();
    const request = {
      paymentType: 'POS',
      safeBankAccount: 'X',
      paymentDate: '2026-07-15',
      currencyCode: 'EGP',
    };
    const results = await resolverWith(get).resolveMany('m-p', [request]);
    expect(results.get(offsetRequestKey(request))?.status).toBe(
      'UNSUPPORTED_PAYMENT_TYPE',
    );
    expect(get).not.toHaveBeenCalled();
  });
});
