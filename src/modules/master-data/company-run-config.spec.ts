import {
  accountingCurrencyQuotation,
  CompanyConfigurationError,
  resolveCompanyRunConfig,
} from './company-run-config';

import { ILedger } from '@/modules/master-data/interfaces/ledger.interface';

const LEGACY = {
  rateType: 'default',
  chartOfAccounts: 'Chart of Accounts',
};

const masLedger = (overrides: Partial<ILedger> = {}): ILedger =>
  ({
    legalEntityId: 'mas',
    accountingCurrency: 'EGP',
    reportingCurrency: 'USD',
    exchangeRateType: 'MASRate',
    chartOfAccounts: 'MAS Chart',
    ...overrides,
  }) as ILedger;

describe('resolveCompanyRunConfig', () => {
  it('keeps the legacy M-P values, even when no ledger row is synced', () => {
    const config = resolveCompanyRunConfig('m-p', [], LEGACY);

    expect(config).toEqual({
      company: 'm-p',
      rateType: 'default',
      reportingRateType: 'Default',
      chartOfAccounts: 'Chart of Accounts',
      accountingCurrency: 'EGP',
      reportingCurrency: 'USD',
      source: 'legacy-m-p',
    });
  });

  it('takes MAS settings only from the MAS ledger row', () => {
    const config = resolveCompanyRunConfig(
      'mas',
      [
        masLedger({ legalEntityId: 'm-p', exchangeRateType: 'MPRate' }),
        masLedger(),
      ],
      LEGACY,
    );

    expect(config.rateType).toBe('MASRate');
    expect(config.chartOfAccounts).toBe('MAS Chart');
    expect(config.source).toBe('ledger');
  });

  it('never falls back to M-P values when the MAS ledger is not synced', () => {
    const attempt = () =>
      resolveCompanyRunConfig(
        'mas',
        [masLedger({ legalEntityId: 'm-p' })],
        LEGACY,
      );

    expect(attempt).toThrow(CompanyConfigurationError);
    expect(attempt).toThrow(/No ledger is synced for company "mas"/);
  });

  it.each([
    ['exchangeRateType', { exchangeRateType: '' }],
    ['chartOfAccounts', { chartOfAccounts: undefined }],
    ['accountingCurrency', { accountingCurrency: '  ' }],
    ['reportingCurrency', { reportingCurrency: undefined }],
  ])('names the missing %s instead of defaulting it', (field, overrides) => {
    try {
      resolveCompanyRunConfig(
        'mas',
        [masLedger(overrides as Partial<ILedger>)],
        LEGACY,
      );
      throw new Error('expected a configuration error');
    } catch (error) {
      expect(error).toBeInstanceOf(CompanyConfigurationError);
      expect((error as CompanyConfigurationError).missing).toContain(field);
    }
  });
});

describe('accountingCurrencyQuotation', () => {
  it('keeps the M-P EGP factor of 100', () => {
    const mp = resolveCompanyRunConfig('m-p', [], LEGACY);
    expect(accountingCurrencyQuotation('EGP', mp)).toBe(100);
    expect(accountingCurrencyQuotation('usd', mp)).toBeUndefined();
  });

  it('uses the factor verified in D365FO for MAS EGP lines', () => {
    const mas = resolveCompanyRunConfig('mas', [masLedger()], LEGACY);
    expect(accountingCurrencyQuotation('EGP', mas)).toBe(100);
  });

  it('refuses an accounting-currency line for a company with no verified factor', () => {
    const mas = resolveCompanyRunConfig('mas', [masLedger({ accountingCurrency: 'EUR' })], LEGACY);
    expect(() => accountingCurrencyQuotation('EUR', mas)).toThrow(
      CompanyConfigurationError,
    );
  });

  it('leaves foreign-currency lines to their own rate for MAS', () => {
    const mas = resolveCompanyRunConfig('mas', [masLedger()], LEGACY);
    expect(accountingCurrencyQuotation('USD', mas)).toBeUndefined();
  });
});
