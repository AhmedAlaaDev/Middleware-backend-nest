import {
  emptyMasRevenueConfig,
  type MasRevenueVerifiedConfig,
} from './mas-revenue-config';

import type { MasRevenueReceipt } from './mas-revenue.types';

/**
 * Test fixtures only. Account IDs and dimensions here are placeholders, not verified
 * MAS values. They exercise the logic; they must never be used as configuration.
 */
export const FIXTURE_CASH_NAME = 'خزينة بور سعيد مصري';

export function completeMasRevenueConfig(
  overrides: Partial<MasRevenueVerifiedConfig> = {},
): MasRevenueVerifiedConfig {
  return {
    ...emptyMasRevenueConfig(),
    journalName: 'GL-VERIFIED',
    cashAccountIdsByDisplayName: { [FIXTURE_CASH_NAME]: 'PETTY-FIXTURE' },
    cashDefaultDimension: 'DIM-CASH',
    cashFinancialTag: '',
    revenueAccountsByRevenueType: {
      Loading: {
        account: '415101',
        defaultDimension: 'DIM-LOADING',
        financialTag: '',
        verified: true,
      },
      In: {
        account: '415701|2401|024|002|005',
        defaultDimension: 'DIM-IN',
        financialTag: '',
        verified: true,
      },
    },
    vatAccount: {
      account: 'VAT-OUT-FIXTURE',
      defaultDimension: 'DIM-VAT',
      financialTag: '',
      verified: true,
    },
    vatRatePercent: 14,
    taxGroups: {
      salesTaxGroup: '',
      itemSalesTaxGroup: 'FIXTURE-ITEM-TAX',
      combinationVerified: true,
    },
    reporting: { currency: 'FIXTURE-RPT', rateType: 'FIXTURE-RATE-TYPE' },
    exchangeRatesByCurrency: {
      EGP: { exchangeRate: 1, reportingExchangeRate: 1 },
    },
    deployedCompatibility: {
      lineServiceVerifiedForGl: true,
      glReadbackVerified: true,
    },
    ...overrides,
  };
}

/** A direct cash receipt: 1,600 value, 224 VAT (14%), 1,824 total. */
export function masReceipt(
  overrides: Partial<MasRevenueReceipt> = {},
): MasRevenueReceipt {
  return {
    sourceSheet: 'Row Data',
    sourceRow: 2,
    invoiceNumber: '1',
    transactionDate: '2026-10-28',
    currency: 'EGP',
    valueMinor: 160000,
    vatMinor: 22400,
    totalMinor: 182400,
    cashAccountDisplayName: FIXTURE_CASH_NAME,
    customerName: 'GIVAUDAN EGYPT',
    containerType: null,
    containerNumber: null,
    billOfLading: null,
    revenueType: 'Loading',
    seaLine: null,
    vatCardNumber: null,
    ...overrides,
  };
}
