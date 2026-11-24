import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  emptyMasRevenueConfig,
  loadMasRevenueConfig,
  MAS_REVENUE_CONFIG_PATH_ENV,
  parseMasRevenueConfig,
} from './mas-revenue-config';
import { MasRevenueError } from './mas-revenue.types';

describe('MAS Revenue configuration loading', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mas-revenue-config-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('closes every gate when no file is configured', () => {
    const { config, source } = loadMasRevenueConfig({});
    expect(source).toBeNull();
    expect(config).toEqual(emptyMasRevenueConfig());
    expect(config.revenueAccountsByRevenueType).toEqual({});
    expect(config.vatAccount).toBeNull();
    expect(config.deployedCompatibility).toEqual({
      lineServiceVerifiedForGl: false,
      glReadbackVerified: false,
    });
  });

  it('closes every gate when the configured file does not exist', () => {
    const { config, source } = loadMasRevenueConfig({
      [MAS_REVENUE_CONFIG_PATH_ENV]: join(dir, 'missing.json'),
    });
    expect(source).toBeNull();
    expect(config.journalName).toBeNull();
  });

  it('reads per-revenue-type accounts and the VAT account from the configured file', () => {
    const path = join(dir, 'mas.json');
    writeFileSync(
      path,
      JSON.stringify({
        companyId: 'mas',
        journalName: 'GL-VERIFIED',
        cashAccountIdsByDisplayName: { 'Port Said': 'PETTY-1' },
        cashDefaultDimension: 'DIM-C',
        cashFinancialTag: '',
        revenueAccountsByRevenueType: {
          'Empty Container Loading Revenue': {
            account: '415101',
            defaultDimension: 'DIM-L',
            financialTag: '',
            verified: true,
          },
        },
        vatAccount: {
          account: 'VAT-OUT',
          defaultDimension: 'DIM-V',
          financialTag: '',
          verified: true,
        },
        vatRatePercent: 14,
        exchangeRatesByCurrency: {
          EGP: { exchangeRate: 1, reportingExchangeRate: 1 },
        },
        deployedCompatibility: {
          lineServiceVerifiedForGl: true,
          glReadbackVerified: false,
        },
      }),
    );
    const { config, source } = loadMasRevenueConfig({
      [MAS_REVENUE_CONFIG_PATH_ENV]: path,
    });
    expect(source).toBe(path);
    expect(
      config.revenueAccountsByRevenueType['Empty Container Loading Revenue'],
    ).toEqual({
      account: '415101',
      defaultDimension: 'DIM-L',
      financialTag: '',
      verified: true,
    });
    expect(config.vatAccount?.account).toBe('VAT-OUT');
    expect(config.vatRatePercent).toBe(14);
    expect(config.deployedCompatibility.glReadbackVerified).toBe(false);
  });

  it('treats a malformed file as an error rather than ignoring it', () => {
    const path = join(dir, 'bad.json');
    writeFileSync(path, '{ not json');
    expect(() =>
      loadMasRevenueConfig({ [MAS_REVENUE_CONFIG_PATH_ENV]: path }),
    ).toThrow(MasRevenueError);
  });
});

describe('parseMasRevenueConfig', () => {
  it('requires a dimension and a financial tag on every revenue mapping, so an omitted value is not a verified empty one', () => {
    expect(() =>
      parseMasRevenueConfig({
        revenueAccountsByRevenueType: {
          Loading: { account: '415101', verified: true },
        },
      }),
    ).toThrow(/defaultDimension" is required/);
    expect(() =>
      parseMasRevenueConfig({
        revenueAccountsByRevenueType: {
          Loading: { account: '415101', defaultDimension: 'D', verified: true },
        },
      }),
    ).toThrow(/financialTag" is required/);
  });

  it('requires an account text on each mapping', () => {
    expect(() =>
      parseMasRevenueConfig({
        revenueAccountsByRevenueType: {
          Loading: { defaultDimension: 'D', financialTag: '' },
        },
      }),
    ).toThrow(/account" must be a non-empty string/);
  });

  it('normalizes the revenue type keys so they match the file text', () => {
    const config = parseMasRevenueConfig({
      revenueAccountsByRevenueType: {
        '  Loading   ': {
          account: '415101',
          defaultDimension: 'D',
          financialTag: '',
          verified: true,
        },
      },
    });
    expect(Object.keys(config.revenueAccountsByRevenueType)).toEqual([
      'Loading',
    ]);
  });

  it('rejects values of the wrong type', () => {
    expect(() => parseMasRevenueConfig({ journalName: 5 })).toThrow(
      /journalName/,
    );
    expect(() => parseMasRevenueConfig({ vatRatePercent: '14' })).toThrow(
      /vatRatePercent/,
    );
    expect(() =>
      parseMasRevenueConfig({
        deployedCompatibility: { glReadbackVerified: 'yes' },
      }),
    ).toThrow(/glReadbackVerified/);
    expect(() => parseMasRevenueConfig([])).toThrow(/JSON object/);
  });
});
