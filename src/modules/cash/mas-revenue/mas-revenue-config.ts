import { existsSync, readFileSync } from 'fs';

import { normalizeSourceText } from './mas-revenue-workbook.parser';
import { MAS_REVENUE_COMPANY_ID } from './mas-revenue.constants';
import { MasRevenueError, type MasRevenueReceipt } from './mas-revenue.types';

/**
 * A ledger account used by a posting line, with the dimensions and financial tag
 * that go with it. `verified` must be set by someone who checked the account in
 * the MAS environment; until then the account blocks submission.
 */
export interface MasRevenueAccountMapping {
  /** Ledger combination, kept as text (e.g. 415101 or 415701|2401|024|002|005). */
  account: string;
  /**
   * Default dimension display value. Required only when the account text does not already
   * carry its dimensions (see compositeCarriesDimensions). Never filled with placeholders.
   */
  defaultDimension: string;
  /** Financial tag. An explicit empty string is allowed when verified empty. */
  financialTag: string;
  verified: boolean;
}

/**
 * Sales-tax and item sales-tax group written on each revenue and VAT line. Both are
 * exact MAS codes (TaxGroups, company mas), set explicitly. Nothing is assumed from
 * a matching text: the same text in the two fields is not proof that either is right.
 * `combinationVerified` must be set only after the sandbox check (procedure section 4)
 * shows that native tax adds no VAT on top of the explicit VAT line.
 * An empty string is allowed for a field only when verified empty.
 */
export interface MasRevenueTaxGroupConfig {
  salesTaxGroup: string | null;
  itemSalesTaxGroup: string | null;
  combinationVerified: boolean;
}

/**
 * Reporting-currency settings for the GL journal. Values come from the MAS ledger
 * (Ledgers: ReportingCurrency, ReportingCurrencyExchangeRateType) and are never
 * defaulted here. A blank rate type in the ledger is reported as missing configuration.
 */
export interface MasRevenueReportingConfig {
  currency: string | null;
  rateType: string | null;
}

/**
 * MAS-scoped configuration that must come from verified D365 metadata or an
 * explicit accounting decision. Nothing here has a default: an unset value is
 * `null`, and `null` blocks submission. An empty string is allowed only where
 * stated, to record that a value was verified empty.
 */
export interface MasRevenueVerifiedConfig {
  companyId: string;
  /** D365 GL JournalName for LedgerJournalHeaders. Not a screenshot label. */
  journalName: string | null;
  /**
   * Cash accounts keyed by the exact name in the source "debit" column. Only these
   * names are treated as cash. Anything else in that column is not a direct cash
   * receipt and is rejected.
   */
  cashAccountIdsByDisplayName: Record<string, string>;
  cashDefaultDimension: string | null;
  cashFinancialTag: string | null;
  /**
   * Revenue account per source "Revenue type", keyed by the normalized text of the
   * Revenue type column. There is no default account: each revenue type needs its
   * own verified mapping.
   */
  revenueAccountsByRevenueType: Record<string, MasRevenueAccountMapping>;
  /** Output VAT ledger account, from the verified MAS tax configuration. */
  vatAccount: MasRevenueAccountMapping | null;
  /** Tax rate in percent (for example 14). Each row's VAT must equal this share of its value. */
  vatRatePercent: number | null;
  /** Explicit tax groups for every line. Null until configured. */
  taxGroups: MasRevenueTaxGroupConfig;
  /** Reporting currency and rate type. Null until configured. */
  reporting: MasRevenueReportingConfig;
  /**
   * Accounting and reporting rates per transaction currency, in the verified scale.
   * The reporting rate is entered per currency here until transaction-date resolution
   * through the existing exchange-rate service is wired in (see the MAS configuration report).
   */
  exchangeRatesByCurrency: Record<
    string,
    { exchangeRate: number; reportingExchangeRate: number } | undefined
  >;
  /** Live D365 confirmations. Submission is blocked while either is false. */
  deployedCompatibility: {
    /** The cash-in line service accepts these lines on the configured GL journal. */
    lineServiceVerifiedForGl: boolean;
    /** Posted GL journal lines can be read back and compared with the expected content. */
    glReadbackVerified: boolean;
  };
}

/** Environment variable that names the verified configuration file. */
export const MAS_REVENUE_CONFIG_PATH_ENV = 'MAS_REVENUE_CONFIG_PATH';

/** Configuration used when no file is supplied: every gate is closed. */
export function emptyMasRevenueConfig(): MasRevenueVerifiedConfig {
  return {
    companyId: MAS_REVENUE_COMPANY_ID,
    journalName: null,
    cashAccountIdsByDisplayName: {},
    cashDefaultDimension: null,
    cashFinancialTag: null,
    revenueAccountsByRevenueType: {},
    vatAccount: null,
    vatRatePercent: null,
    taxGroups: {
      salesTaxGroup: null,
      itemSalesTaxGroup: null,
      combinationVerified: false,
    },
    reporting: { currency: null, rateType: null },
    exchangeRatesByCurrency: {},
    deployedCompatibility: {
      lineServiceVerifiedForGl: false,
      glReadbackVerified: false,
    },
  };
}

/**
 * Loads the verified configuration from the JSON file named by
 * MAS_REVENUE_CONFIG_PATH. A missing or unreadable file returns the closed
 * configuration, so submission is blocked rather than guessed. A file that
 * exists but is malformed is an error, because it must be fixed, not ignored.
 */
export function loadMasRevenueConfig(env: NodeJS.ProcessEnv = process.env): {
  config: MasRevenueVerifiedConfig;
  source: string | null;
} {
  const path = env[MAS_REVENUE_CONFIG_PATH_ENV]?.trim();
  if (!path || !existsSync(path)) {
    return { config: emptyMasRevenueConfig(), source: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new MasRevenueError(
      `MAS Revenue configuration at ${MAS_REVENUE_CONFIG_PATH_ENV} is not valid JSON`,
    );
  }
  return { config: parseMasRevenueConfig(parsed), source: path };
}

/** Accepts only the documented shape. Known keys must have the right type. */
export function parseMasRevenueConfig(
  input: unknown,
): MasRevenueVerifiedConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MasRevenueError(
      'MAS Revenue configuration must be a JSON object',
    );
  }
  const base = emptyMasRevenueConfig();
  const raw = input as Record<string, unknown>;

  const str = (key: string): string | null => {
    const value = raw[key];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      throw new MasRevenueError(
        `MAS Revenue configuration "${key}" must be a string`,
      );
    }
    return value;
  };
  const bool = (value: unknown, key: string): boolean => {
    if (value === undefined) return false;
    if (typeof value !== 'boolean') {
      throw new MasRevenueError(
        `MAS Revenue configuration "${key}" must be true or false`,
      );
    }
    return value;
  };
  const object = (value: unknown, key: string): Record<string, unknown> => {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new MasRevenueError(
        `MAS Revenue configuration "${key}" must be an object`,
      );
    }
    return value as Record<string, unknown>;
  };
  const mapping = (
    value: unknown,
    key: string,
  ): MasRevenueAccountMapping | null => {
    if (value === undefined || value === null) return null;
    const item = object(value, key);
    if (typeof item.account !== 'string' || item.account.trim() === '') {
      throw new MasRevenueError(
        `MAS Revenue configuration "${key}.account" must be a non-empty string`,
      );
    }
    // Both must be present: an omitted value is not the same as a value verified empty.
    if (typeof item.defaultDimension !== 'string') {
      throw new MasRevenueError(
        `MAS Revenue configuration "${key}.defaultDimension" is required (use an empty string only if verified empty)`,
      );
    }
    if (typeof item.financialTag !== 'string') {
      throw new MasRevenueError(
        `MAS Revenue configuration "${key}.financialTag" is required (use an empty string only if verified empty)`,
      );
    }
    return {
      account: item.account.trim(),
      defaultDimension: item.defaultDimension,
      financialTag: item.financialTag,
      verified: bool(item.verified, `${key}.verified`),
    };
  };

  const cash = object(
    raw.cashAccountIdsByDisplayName,
    'cashAccountIdsByDisplayName',
  );
  const revenue = object(
    raw.revenueAccountsByRevenueType,
    'revenueAccountsByRevenueType',
  );
  const rates = object(raw.exchangeRatesByCurrency, 'exchangeRatesByCurrency');
  const compat = object(raw.deployedCompatibility, 'deployedCompatibility');
  const taxGroups = object(raw.taxGroups, 'taxGroups');
  const reporting = object(raw.reporting, 'reporting');

  const optionalText = (value: unknown, key: string): string | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      throw new MasRevenueError(
        `MAS Revenue configuration "${key}" must be a string`,
      );
    }
    return value.trim();
  };

  const vatRate = raw.vatRatePercent ?? null;
  if (
    vatRate !== null &&
    (typeof vatRate !== 'number' || !Number.isFinite(vatRate) || vatRate < 0)
  ) {
    throw new MasRevenueError(
      'MAS Revenue configuration "vatRatePercent" must be a non-negative number or null',
    );
  }

  return {
    ...base,
    companyId: str('companyId') ?? base.companyId,
    journalName: str('journalName'),
    cashAccountIdsByDisplayName: Object.fromEntries(
      Object.entries(cash).map(([name, id]) => {
        if (id !== undefined && id !== null && typeof id !== 'string') {
          throw new MasRevenueError(
            `MAS Revenue configuration cash account "${name}" must map to a text ID`,
          );
        }
        return [normalizeSourceText(name), typeof id === 'string' ? id : ''];
      }),
    ),
    cashDefaultDimension: str('cashDefaultDimension'),
    cashFinancialTag: str('cashFinancialTag'),
    revenueAccountsByRevenueType: Object.fromEntries(
      Object.entries(revenue).map(([type, value]) => [
        normalizeSourceText(type),
        mapping(
          value,
          `revenueAccountsByRevenueType.${type}`,
        ) as MasRevenueAccountMapping,
      ]),
    ),
    vatAccount: mapping(raw.vatAccount, 'vatAccount'),
    vatRatePercent: vatRate,
    taxGroups: {
      salesTaxGroup: optionalText(
        taxGroups.salesTaxGroup,
        'taxGroups.salesTaxGroup',
      ),
      itemSalesTaxGroup: optionalText(
        taxGroups.itemSalesTaxGroup,
        'taxGroups.itemSalesTaxGroup',
      ),
      combinationVerified: bool(
        taxGroups.combinationVerified,
        'taxGroups.combinationVerified',
      ),
    },
    reporting: {
      currency: optionalText(reporting.currency, 'reporting.currency'),
      rateType: optionalText(reporting.rateType, 'reporting.rateType'),
    },
    exchangeRatesByCurrency:
      rates as MasRevenueVerifiedConfig['exchangeRatesByCurrency'],
    deployedCompatibility: {
      lineServiceVerifiedForGl: bool(
        compat.lineServiceVerifiedForGl,
        'deployedCompatibility.lineServiceVerifiedForGl',
      ),
      glReadbackVerified: bool(
        compat.glReadbackVerified,
        'deployedCompatibility.glReadbackVerified',
      ),
    },
  };
}

/** The receipt fields the gates need. Stored snapshots and parsed receipts both satisfy it. */
export type MasRevenueGateReceipt = Pick<
  MasRevenueReceipt,
  | 'invoiceNumber'
  | 'currency'
  | 'cashAccountDisplayName'
  | 'revenueType'
  | 'valueMinor'
  | 'vatMinor'
>;

/** The VAT a row must carry under the configured rate, in minor units (half up). */
export function expectedVatMinor(
  valueMinor: number,
  ratePercent: number,
): number {
  return Math.round((valueMinor * ratePercent) / 100);
}

/**
 * Every reason the receipts cannot be sent to D365 yet. An empty list means the
 * configuration covers them. Each message names the item to fix, so the review
 * can show it. A caller must treat any blocker as a hard stop before a header is
 * created.
 */
export function getMasRevenueSubmissionBlockers(
  config: MasRevenueVerifiedConfig,
  receipts: MasRevenueGateReceipt[],
): string[] {
  const blockers: string[] = [];

  // A receipt's currency is its D365 cash account's currency. Without a verified
  // account it is unknown, and the receipt cannot be posted.
  const unresolved = [
    ...new Set(
      receipts
        .filter((receipt) => !receipt.currency)
        .map((receipt) => receipt.cashAccountDisplayName),
    ),
  ];
  for (const name of unresolved) {
    blockers.push(
      `cash account "${name}": currency is not resolved from D365 (the account value must exist as an RCash account in D365)`,
    );
  }

  if (config.companyId !== MAS_REVENUE_COMPANY_ID) {
    blockers.push(
      `company must be "${MAS_REVENUE_COMPANY_ID}"; configuration has "${config.companyId}"`,
    );
  }
  if (!config.journalName) {
    blockers.push(
      'GL JournalName is not configured (verify the MAS GL journal name in D365)',
    );
  }
  if (!config.cashDefaultDimension?.trim()) {
    blockers.push(
      'cash default dimensions are not set (verify the cash-side dimension string in D365)',
    );
  }
  if (config.cashFinancialTag === null) {
    blockers.push(
      'cash financial tag is not set (enter the verified value, or an explicit empty string)',
    );
  }

  // VAT is credited exactly once, through the verified tax configuration.
  if (config.vatRatePercent === null) {
    blockers.push(
      'VAT rate is not configured (tax configuration); VAT cannot be posted until it is set',
    );
  }
  if (!config.vatAccount) {
    blockers.push('VAT account is not configured (tax configuration)');
  } else {
    if (!config.vatAccount.verified) {
      blockers.push(
        `VAT account ${config.vatAccount.account} has not been verified in MAS`,
      );
    }
    if (
      !config.vatAccount.defaultDimension.trim() &&
      !compositeCarriesDimensions(config.vatAccount.account)
    ) {
      blockers.push(
        `VAT account ${config.vatAccount.account} has no verified default dimension`,
      );
    }
  }

  // Tax groups are explicit MAS codes. A value is never inferred from a matching text,
  // and the pair is usable only after the sandbox shows native tax adds no VAT.
  if (config.taxGroups.salesTaxGroup === null) {
    blockers.push(
      'sales-tax group (TaxGroup) is not configured; enter the exact MAS code, or an empty string if verified empty',
    );
  } else if (config.taxGroups.salesTaxGroup.toUpperCase() === 'NON-TAXABL') {
    blockers.push(
      'sales-tax group "Non-Taxabl" is not a MAS tax group code (TaxGroups in mas has NONTAXABLE and TAX); configure a verified code',
    );
  }
  if (config.taxGroups.itemSalesTaxGroup === null) {
    blockers.push(
      'item sales-tax group (TAXITEMGROUP) is not configured; enter the exact MAS code, or an empty string if verified empty',
    );
  }
  if (!config.taxGroups.combinationVerified) {
    blockers.push(
      'the tax-group combination has not been verified: confirm in the sandbox that native tax adds no VAT on top of the explicit VAT line (procedure section 4)',
    );
  }

  // Reporting currency and rate type come from the MAS ledger; neither is defaulted.
  if (!config.reporting.currency) {
    blockers.push(
      'reporting currency is not configured (MAS ledger ReportingCurrency is USD; enter it in the reporting configuration)',
    );
  }
  if (!config.reporting.rateType) {
    blockers.push(
      'reporting exchange-rate type is not configured (MAS ledger ReportingCurrencyExchangeRateType is blank; the business must choose the rate type, for example Default or Average)',
    );
  }

  // Scope: only direct cash revenue. Anything else is explained, not guessed.
  const cashNames = new Set(
    receipts.map((r) => normalizeSourceText(r.cashAccountDisplayName)),
  );
  for (const name of cashNames) {
    const id = config.cashAccountIdsByDisplayName[name];
    if (id === undefined) {
      // Unknown or unsupported is all a failed lookup establishes. A credit
      // transaction is reported only when the source itself shows one.
      blockers.push(
        `unknown or unsupported cash account "${name}": it is not in the verified cash-account configuration. ` +
          'This flow supports only direct cash revenue (bank accounts are not supported yet).',
      );
    } else if (id.trim() === '') {
      blockers.push(`cash account "${name}" has no verified MAS account ID`);
    }
  }

  const revenueTypes = new Map<string, string[]>();
  for (const receipt of receipts) {
    const key =
      receipt.revenueType === null
        ? ''
        : normalizeSourceText(receipt.revenueType);
    if (key === '') {
      blockers.push(
        `invoice ${receipt.invoiceNumber}: Revenue type is empty; a revenue account is required`,
      );
      continue;
    }
    revenueTypes.set(key, [
      ...(revenueTypes.get(key) ?? []),
      receipt.invoiceNumber,
    ]);
  }
  for (const key of revenueTypes.keys()) {
    const mapping = config.revenueAccountsByRevenueType[key];
    if (!mapping) {
      blockers.push(
        `Revenue type "${key}" has no revenue account in configuration`,
      );
      continue;
    }
    if (!mapping.verified) {
      blockers.push(
        `Revenue type "${key}" account ${mapping.account} has not been verified in MAS`,
      );
    }
    if (
      !mapping.defaultDimension.trim() &&
      !compositeCarriesDimensions(mapping.account)
    ) {
      blockers.push(
        `Revenue type "${key}" account ${mapping.account} has no verified default dimension`,
      );
    }
  }

  if (config.vatRatePercent !== null) {
    for (const receipt of receipts) {
      const expected = expectedVatMinor(
        receipt.valueMinor,
        config.vatRatePercent,
      );
      if (receipt.vatMinor !== expected) {
        blockers.push(
          `invoice ${receipt.invoiceNumber}: VAT ${minorText(receipt.vatMinor)} does not equal ` +
            `${config.vatRatePercent}% of value ${minorText(receipt.valueMinor)} (${minorText(expected)})`,
        );
      }
    }
  }

  const currencies = new Set(receipts.map((r) => r.currency));
  for (const currency of currencies) {
    const rate = config.exchangeRatesByCurrency[currency];
    if (!rate) {
      blockers.push(`no verified exchange rates for currency ${currency}`);
    } else if (
      rate.reportingExchangeRate === null ||
      rate.reportingExchangeRate === undefined
    ) {
      blockers.push(
        `reporting exchange rate for ${currency} is not set (verify the reporting-currency rate and its scale in MAS)`,
      );
    } else if (
      !Number.isFinite(rate.exchangeRate) ||
      !Number.isFinite(rate.reportingExchangeRate) ||
      rate.exchangeRate <= 0 ||
      rate.reportingExchangeRate <= 0
    ) {
      blockers.push(
        `exchange rates for ${currency} must be positive finite numbers`,
      );
    }
  }

  if (!config.deployedCompatibility.lineServiceVerifiedForGl) {
    blockers.push(
      'the cash-in line service has not been verified for RCash-to-Ledger on a GL journal in this environment',
    );
  }
  if (!config.deployedCompatibility.glReadbackVerified) {
    blockers.push(
      'GL journal readback has not been verified in this environment',
    );
  }
  if (receipts.length === 0) {
    blockers.push('there are no accepted receipts to submit');
  }

  return blockers;
}

/**
 * True when a ledger combination carries dimension segments after its main account, for
 * example 415701|2401|024|002|005. Such an account needs no separate default-dimension
 * string: repeating the segments would be redundant. A bare main account does not carry them.
 */
export function compositeCarriesDimensions(account: string): boolean {
  return account
    .split('|')
    .slice(1)
    .some((segment) => segment.trim() !== '');
}

function minorText(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
