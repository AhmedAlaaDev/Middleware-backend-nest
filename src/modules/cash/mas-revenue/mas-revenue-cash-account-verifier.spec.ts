/* eslint-disable @typescript-eslint/require-await */
import {
  MasRevenueCashAccountVerifier,
  masRevenueCashAccountBlockers,
  receiptCurrenciesByCashId,
} from './mas-revenue-cash-account-verifier';

import { ODataQueryBuilderService } from '@/modules/d365fo/services/odata-query-builder.service';

type Fixture = {
  cash?: Array<{ Cash: string; Currency: string }>;
  bank?: Array<{ BankAccountId: string }>;
  fail?: string;
};

/** Fake D365 client that answers CashAccounts and BankAccounts from a fixture, as a real read would. */
function fakeD365(fixture: Fixture) {
  const endpoints: string[] = [];
  const client = {
    get: jest.fn(async (endpoint: string) => {
      endpoints.push(endpoint);
      const decoded = decodeURIComponent(endpoint);
      if (fixture.fail && decoded.includes(fixture.fail)) {
        throw new Error('D365 unavailable');
      }
      if (decoded.includes('/data/CashAccounts')) {
        const rows = (fixture.cash ?? []).filter((row) =>
          decoded.includes(`Cash eq '${row.Cash}'`),
        );
        return { value: rows };
      }
      if (decoded.includes('/data/BankAccounts')) {
        const rows = (fixture.bank ?? []).filter((row) =>
          decoded.includes(`BankAccountId eq '${row.BankAccountId}'`),
        );
        return { value: rows };
      }
      return { value: [] };
    }),
  };
  return { client, endpoints };
}

function verifierFor(fixture: Fixture) {
  const { client, endpoints } = fakeD365(fixture);
  const verifier = new MasRevenueCashAccountVerifier(
    client as never,
    new ODataQueryBuilderService(),
  );
  return { verifier, endpoints };
}

describe('MasRevenueCashAccountVerifier', () => {
  it('classifies a configured ID that exists in CashAccounts for mas as RCASH, with its currency', async () => {
    const { verifier } = verifierFor({
      cash: [{ Cash: 'Port Said', Currency: 'EGP' }],
    });
    const [check] = await verifier.verify(['Port Said']);
    expect(check).toEqual({
      id: 'Port Said',
      status: 'RCASH',
      currency: 'EGP',
      error: null,
    });
  });

  it('queries the mas company and the exact ID, so no other company or account can match', async () => {
    const { verifier, endpoints } = verifierFor({ cash: [] });
    await verifier.verify(['Port Said']);
    const decoded = decodeURIComponent(endpoints[0]);
    expect(decoded).toContain("dataAreaId eq 'mas'");
    expect(decoded).toContain("Cash eq 'Port Said'");
  });

  it('classifies an ID found only in BankAccounts as BANK_ONLY, and never as RCASH', async () => {
    const { verifier } = verifierFor({
      bank: [{ BankAccountId: 'QNB-EU-OD' }],
    });
    const [check] = await verifier.verify(['QNB-EU-OD']);
    expect(check.status).toBe('BANK_ONLY');
    expect(check.currency).toBeNull();
  });

  it('classifies an ID found in neither entity as UNKNOWN', async () => {
    const { verifier } = verifierFor({});
    const [check] = await verifier.verify(['Nope']);
    expect(check.status).toBe('UNKNOWN');
  });

  it('fails closed: a failed read is UNVERIFIABLE, not treated as valid', async () => {
    const { verifier } = verifierFor({ fail: 'CashAccounts' });
    const [check] = await verifier.verify(['Port Said']);
    expect(check.status).toBe('UNVERIFIABLE');
    expect(check.error).toMatch(/D365 unavailable/);
    expect(masRevenueCashAccountBlockers([check], new Map())).toEqual([
      expect.stringMatching(
        /cash-account verification failed.*not an unknown account/,
      ),
    ]);
  });

  it('checks each distinct configured ID once and ignores blank entries', async () => {
    const { verifier, endpoints } = verifierFor({
      cash: [{ Cash: 'Port Said', Currency: 'EGP' }],
    });
    const checks = await verifier.verify(['Port Said', 'Port Said', '  ', '']);
    expect(checks).toHaveLength(1);
    expect(
      endpoints.filter((e) => decodeURIComponent(e).includes('CashAccounts')),
    ).toHaveLength(1);
  });
});

describe('masRevenueCashAccountBlockers', () => {
  const currencies = new Map([['Port Said', ['EGP']]]);

  it('passes a verified RCash account in the receipt currency', () => {
    expect(
      masRevenueCashAccountBlockers(
        [{ id: 'Port Said', status: 'RCASH', currency: 'EGP', error: null }],
        currencies,
      ),
    ).toEqual([]);
  });

  it('blocks a receipt currency that differs from the D365 cash-account currency', () => {
    const blockers = masRevenueCashAccountBlockers(
      [{ id: 'Port Said', status: 'RCASH', currency: 'USD', error: null }],
      currencies,
    );
    expect(blockers.join(' ')).toMatch(
      /is in USD in D365; receipts in EGP cannot be posted to it/,
    );
  });

  it('blocks a bank-only account with an explanation', () => {
    const blockers = masRevenueCashAccountBlockers(
      [{ id: 'QNB-EU-OD', status: 'BANK_ONLY', currency: null, error: null }],
      new Map(),
    );
    expect(blockers.join(' ')).toMatch(
      /is a bank account in D365\. RCash posting is not supported/,
    );
  });

  it('blocks an unknown account', () => {
    const blockers = masRevenueCashAccountBlockers(
      [{ id: 'Nope', status: 'UNKNOWN', currency: null, error: null }],
      new Map(),
    );
    expect(blockers.join(' ')).toMatch(
      /does not exist in CashAccounts for company mas/,
    );
  });
});

describe('receiptCurrenciesByCashId', () => {
  it('maps each configured cash ID to the currencies of the receipts that post to it', () => {
    const map = receiptCurrenciesByCashId({ 'source name': 'Port Said' }, [
      { cashAccountDisplayName: 'source name', currency: 'EGP' },
      { cashAccountDisplayName: 'other name', currency: 'USD' },
    ]);
    expect(map.get('Port Said')).toEqual(['EGP']);
    expect(map.has('other name')).toBe(false);
  });
});

describe('MasRevenueCashAccountVerifier.readReportingRates', () => {
  type Rate = { RateTypeName: string; Rate: number; ConversionFactor: string };
  // The USD to EGP rates the MAS sandbox holds for 2026-10-28, one per rate type.
  const OCTOBER_RATES: Rate[] = [
    { RateTypeName: 'Global', Rate: 26, ConversionFactor: 'One' },
    { RateTypeName: 'Budget', Rate: 47, ConversionFactor: 'One' },
    { RateTypeName: 'Closing', Rate: 47.65, ConversionFactor: 'One' },
    { RateTypeName: 'Default', Rate: 52, ConversionFactor: 'One' },
    { RateTypeName: 'Average', Rate: 52, ConversionFactor: 'One' },
  ];

  function readerFor(
    ledger: Record<string, string>,
    rates: Rate[] = OCTOBER_RATES,
  ) {
    const endpoints: string[] = [];
    const client = {
      get: jest.fn(async (endpoint: string) => {
        endpoints.push(endpoint);
        const decoded = decodeURIComponent(endpoint);
        if (decoded.includes('/data/Ledgers')) return { value: [ledger] };
        if (decoded.includes('/data/ExchangeRates')) {
          const type = /RateTypeName eq '([^']+)'/.exec(decoded)?.[1];
          return {
            value: rates.filter((rate) => !type || rate.RateTypeName === type),
          };
        }
        return { value: [] };
      }),
    };
    const verifier = new MasRevenueCashAccountVerifier(
      client as never,
      new ODataQueryBuilderService(),
    );
    return { verifier, endpoints };
  }

  const MAS_LEDGER = {
    AccountingCurrency: 'EGP',
    ReportingCurrency: 'USD',
    ReportingCurrencyExchangeRateType: '',
    ExchangeRateType: 'Average',
  };

  it('uses the ledger exchange-rate type when the reporting type is blank, so five rate types do not disagree', async () => {
    const { verifier, endpoints } = readerFor(MAS_LEDGER);
    const [check] = await verifier.readReportingRates(['2026-10-28']);
    expect(check.error).toBeNull();
    expect(check.reportingExchangeRate).toBeCloseTo(100 / 52, 10);
    const rateQuery = decodeURIComponent(
      endpoints.find((e) => e.includes('ExchangeRates')) ?? '',
    );
    expect(rateQuery).toContain("RateTypeName eq 'Average'");
  });

  it('prefers the ledger reporting-currency rate type when it is set', async () => {
    const { verifier } = readerFor(
      { ...MAS_LEDGER, ReportingCurrencyExchangeRateType: 'Closing' },
      OCTOBER_RATES,
    );
    const [check] = await verifier.readReportingRates(['2026-10-28']);
    expect(check.reportingExchangeRate).toBeCloseTo(100 / 47.65, 10);
  });

  it('reports a ledger with no rate type instead of choosing one', async () => {
    const { verifier } = readerFor({ ...MAS_LEDGER, ExchangeRateType: '' });
    const [check] = await verifier.readReportingRates(['2026-10-28']);
    expect(check.reportingExchangeRate).toBeNull();
    expect(check.error).toContain('names no exchange-rate type');
  });

  it('reports no rate of the ledger type, and disagreeing rates of that one type', async () => {
    const none = readerFor(MAS_LEDGER, [
      { RateTypeName: 'Default', Rate: 52, ConversionFactor: 'One' },
    ]);
    const [missing] = await none.verifier.readReportingRates(['2026-10-28']);
    expect(missing.error).toContain('no USD to EGP Average exchange rate');

    const twice = readerFor(MAS_LEDGER, [
      { RateTypeName: 'Average', Rate: 52, ConversionFactor: 'One' },
      { RateTypeName: 'Average', Rate: 53, ConversionFactor: 'One' },
    ]);
    const [clash] = await twice.verifier.readReportingRates(['2026-10-28']);
    expect(clash.error).toContain('Average rates valid on 2026-10-28 disagree');
  });
});
