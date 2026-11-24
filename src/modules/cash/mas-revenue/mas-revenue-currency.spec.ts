import { emptyMasRevenueConfig } from './mas-revenue-config';
import {
  cashAccountIdForCurrency,
  cashIdsToLookUp,
  resolveReceiptCurrencies,
} from './mas-revenue-currency';

import type { MasRevenueReceipt } from './mas-revenue.types';

function receipt(cashAccountDisplayName: string): MasRevenueReceipt {
  return {
    sourceSheet: 'Row Data',
    sourceRow: 2,
    invoiceNumber: '1',
    transactionDate: '2026-10-28',
    currency: '',
    valueMinor: 160000,
    vatMinor: 22400,
    totalMinor: 182400,
    cashAccountDisplayName,
    customerName: 'GIVAUDAN EGYPT',
    containerType: null,
    containerNumber: null,
    billOfLading: null,
    revenueType: 'In',
    seaLine: null,
    vatCardNumber: null,
  };
}

const configured = {
  ...emptyMasRevenueConfig(),
  cashAccountIdsByDisplayName: { 'Source Name': 'CONFIGURED-ID' },
};

describe('cashAccountIdForCurrency', () => {
  it('uses the configured cash ID when the display name is mapped', () => {
    expect(cashAccountIdForCurrency(receipt('Source Name'), configured)).toBe(
      'CONFIGURED-ID',
    );
  });

  it('uses the sheet value as the D365 cash ID when it is not mapped', () => {
    expect(
      cashAccountIdForCurrency(receipt('  Port   Said '), configured),
    ).toBe('Port Said');
  });
});

describe('cashIdsToLookUp', () => {
  it('returns each unmapped account once, and none for mapped accounts', () => {
    const ids = cashIdsToLookUp(
      [receipt('Port Said'), receipt('Port Said'), receipt('Source Name')],
      configured,
    );
    expect(ids).toEqual(['Port Said']);
  });
});

describe('resolveReceiptCurrencies', () => {
  const rcash = (id: string, currency: string | null) => ({
    id,
    status: 'RCASH' as const,
    currency,
    error: null,
  });

  it('takes the currency of the D365 cash account found by the sheet value', () => {
    const [resolved] = resolveReceiptCurrencies(
      [receipt('Port Said')],
      configured,
      [rcash('Port Said', 'EGP')],
    );
    expect(resolved.currency).toBe('EGP');
  });

  it('takes the currency of the configured cash ID when mapped', () => {
    const [resolved] = resolveReceiptCurrencies(
      [receipt('Source Name')],
      configured,
      [rcash('CONFIGURED-ID', 'USD')],
    );
    expect(resolved.currency).toBe('USD');
  });

  it('leaves the currency empty when the account is not an RCash account with a currency', () => {
    for (const check of [
      {
        id: 'Port Said',
        status: 'UNKNOWN' as const,
        currency: null,
        error: null,
      },
      {
        id: 'Port Said',
        status: 'BANK_ONLY' as const,
        currency: null,
        error: null,
      },
      rcash('Port Said', null),
    ]) {
      const [resolved] = resolveReceiptCurrencies(
        [receipt('Port Said')],
        configured,
        [check],
      );
      expect(resolved.currency).toBe('');
    }
  });
});
