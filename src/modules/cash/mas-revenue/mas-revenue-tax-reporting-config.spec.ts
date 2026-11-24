import {
  getMasRevenueSubmissionBlockers,
  parseMasRevenueConfig,
} from './mas-revenue-config';
import {
  completeMasRevenueConfig,
  masReceipt,
} from './mas-revenue.test-fixtures';

describe('explicit tax-group configuration', () => {
  it('has no default: an unconfigured tax group blocks submission', () => {
    const blockers = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig({
        taxGroups: {
          salesTaxGroup: null,
          itemSalesTaxGroup: null,
          combinationVerified: false,
        },
      }),
      [masReceipt()],
    ).join(' ');
    expect(blockers).toMatch(/sales-tax group \(TaxGroup\) is not configured/);
    expect(blockers).toMatch(
      /item sales-tax group \(TAXITEMGROUP\) is not configured/,
    );
  });

  it('blocks until the tax-group combination is verified in the sandbox', () => {
    const blockers = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig({
        taxGroups: {
          salesTaxGroup: '',
          itemSalesTaxGroup: 'NONTAXABLE',
          combinationVerified: false,
        },
      }),
      [masReceipt()],
    ).join(' ');
    expect(blockers).toMatch(/tax-group combination has not been verified/);
  });

  it('rejects "Non-Taxabl" as a sales-tax group, because it is not a MAS code', () => {
    const blockers = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig({
        taxGroups: {
          salesTaxGroup: 'Non-Taxabl',
          itemSalesTaxGroup: 'NONTAXABLE',
          combinationVerified: true,
        },
      }),
      [masReceipt()],
    ).join(' ');
    expect(blockers).toMatch(/"Non-Taxabl" is not a MAS tax group code/);
  });

  it('passes the tax check when the combination is configured and verified', () => {
    const blockers = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig(),
      [masReceipt()],
    );
    expect(blockers.join(' ')).not.toMatch(/tax/i);
  });

  it('reads taxGroups from the file and keeps an empty string as verified empty', () => {
    const config = parseMasRevenueConfig({
      taxGroups: {
        salesTaxGroup: '',
        itemSalesTaxGroup: 'NONTAXABLE',
        combinationVerified: true,
      },
    });
    expect(config.taxGroups).toEqual({
      salesTaxGroup: '',
      itemSalesTaxGroup: 'NONTAXABLE',
      combinationVerified: true,
    });
  });

  it('rejects a non-text tax group in the file', () => {
    expect(() =>
      parseMasRevenueConfig({ taxGroups: { salesTaxGroup: 5 } }),
    ).toThrow(/taxGroups.salesTaxGroup" must be a string/);
  });
});

describe('reporting configuration', () => {
  it('blocks when the reporting currency or rate type is not configured, and names the ledger evidence', () => {
    const blockers = getMasRevenueSubmissionBlockers(
      completeMasRevenueConfig({
        reporting: { currency: null, rateType: null },
      }),
      [masReceipt()],
    ).join(' ');
    expect(blockers).toMatch(
      /reporting currency is not configured \(MAS ledger ReportingCurrency is USD/,
    );
    expect(blockers).toMatch(
      /reporting exchange-rate type is not configured \(MAS ledger ReportingCurrencyExchangeRateType is blank/,
    );
  });

  it('reads reporting currency and rate type from the file', () => {
    const config = parseMasRevenueConfig({
      reporting: { currency: 'USD', rateType: 'Default' },
    });
    expect(config.reporting).toEqual({ currency: 'USD', rateType: 'Default' });
  });

  it('defaults both to null, never to a currency or rate type', () => {
    const config = parseMasRevenueConfig({});
    expect(config.reporting).toEqual({ currency: null, rateType: null });
  });
});
