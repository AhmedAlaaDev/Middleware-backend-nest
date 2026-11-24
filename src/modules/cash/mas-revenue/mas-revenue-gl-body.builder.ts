import {
  getMasRevenueSubmissionBlockers,
  type MasRevenueAccountMapping,
  type MasRevenueVerifiedConfig,
} from './mas-revenue-config';
import { masRevenueGlPaymentId } from './mas-revenue-identity';
import { normalizeSourceText } from './mas-revenue-workbook.parser';
import {
  MAS_REVENUE_COMPANY_ID,
  MAS_REVENUE_LIMITS,
} from './mas-revenue.constants';
import { MasRevenueError, type MasRevenueReceipt } from './mas-revenue.types';

import type { TSLedgerJournalTransCustomRequestBody } from '@/modules/d365fo/types/d365fo-cash-custom-ledger-journal.type';

/** Body for POST /data/LedgerJournalHeaders. JournalBatchNumber comes from the response. */
export interface MasRevenueGlHeaderBody {
  dataAreaId: string;
  JournalName: string;
  Description: string;
}

/**
 * Internal cash-in line shape. The existing line service projects it onto the
 * exact `_contract.Lines` wire keys (toD365BulkCashLine), so this builder never
 * writes wire keys itself and no second serializer exists.
 */
export type MasRevenueInternalLine = TSLedgerJournalTransCustomRequestBody;

/** One planned line and the source row it came from. */
export interface MasRevenueGlLine {
  sourceRow: number;
  body: MasRevenueInternalLine;
}

/**
 * Builds the GL header body. Refuses to build while any blocker remains, so a
 * header is never created for unverified configuration.
 */
export function buildMasRevenueGlHeaderBody(
  config: MasRevenueVerifiedConfig,
  receipts: MasRevenueReceipt[],
  uploadReference: string,
): MasRevenueGlHeaderBody {
  assertNoBlockers(config, receipts);
  return {
    dataAreaId: MAS_REVENUE_COMPANY_ID,
    JournalName: config.journalName as string,
    Description: `MAS Revenue Cash In ${uploadReference}`.slice(0, 60),
  };
}

/**
 * Builds the direct cash revenue lines for each receipt. The cash account is
 * debited for the full amount, in two lines, each balanced against its own
 * offset account:
 *   1. value against the revenue account selected by the row's Revenue type;
 *   2. VAT against the verified VAT account, when the row carries VAT.
 * The VAT appears exactly once, and the debits add up to the row's Total.
 *
 * `journalNum` is left empty at enqueue time. The line service fills it with the
 * header key that D365 returned, and rejects a line that names a different journal.
 */
export function buildMasRevenueGlLines(
  config: MasRevenueVerifiedConfig,
  receipts: MasRevenueReceipt[],
): MasRevenueGlLine[] {
  assertNoBlockers(config, receipts);

  const lines: MasRevenueGlLine[] = [];
  for (const receipt of receipts) {
    const text = buildTransactionText(receipt);
    const revenue = revenueMappingFor(config, receipt);
    lines.push({
      sourceRow: receipt.sourceRow,
      body: lineBody(config, receipt, {
        suffix: 'REV',
        amountMinor: receipt.valueMinor,
        offset: revenue,
        text,
      }),
    });
    if (receipt.vatMinor > 0) {
      lines.push({
        sourceRow: receipt.sourceRow,
        body: lineBody(config, receipt, {
          suffix: 'VAT',
          amountMinor: receipt.vatMinor,
          offset: vatMappingFor(config),
          text,
        }),
      });
    }
  }
  return lines;
}

function lineBody(
  config: MasRevenueVerifiedConfig,
  receipt: MasRevenueReceipt,
  part: {
    suffix: 'REV' | 'VAT';
    amountMinor: number;
    offset: MasRevenueAccountMapping;
    text: string;
  },
): MasRevenueInternalLine {
  const cashName = normalizeSourceText(receipt.cashAccountDisplayName);
  const rates = config.exchangeRatesByCurrency[receipt.currency] as NonNullable<
    MasRevenueVerifiedConfig['exchangeRatesByCurrency'][string]
  >;
  return {
    journalNum: '',
    AccountNum: config.cashAccountIdsByDisplayName[cashName],
    accountTypeStr: 'RCash',
    BANKTRANSACTIONTYPE: '',
    CENTRALBANKPURPOSECODE: '',
    CENTRALBANKPURPOSETEXT: '',
    company: MAS_REVENUE_COMPANY_ID,
    creditAmount: 0,
    currency: receipt.currency,
    debitAmount: minorToMajor(part.amountMinor),
    DEFAULTDIMENSIONDISPLAYVALUE: config.cashDefaultDimension as string,
    offsetDEFAULTDIMENSIONDISPLAYVALUE: part.offset.defaultDimension,
    FinTagStr: config.cashFinancialTag as string,
    ISPREPAYMENT: 'No',
    ITEMWITHHOLDINGTAXGROUP: '',
    MarkedLines: [],
    offsetAccountDisplayValue: part.offset.account,
    OffsetAccountTypeStr: 'Ledger',
    OffsetCompany: MAS_REVENUE_COMPANY_ID,
    OFFSETFINTAGDISPLAYVALUE: part.offset.financialTag,
    OFFSETTRANSACTIONTEXT: part.text,
    // Version 2: year-scoped, hash-based id. Legacy receipts keep MASREV-<invoice>-<suffix>.
    PAYMENTID: masRevenueGlPaymentId(receipt, part.suffix),
    PAYMENTMETHODNAME: '',
    PAYMENTNOTES: '',
    PAYMENTREFERENCE: '',
    PAYMENTSPECIFICATION: '',
    PostingProfile: '',
    // Explicit, company-scoped tax groups from configuration. D365 must not add VAT on
    // top of the explicit VAT line; that is what the sandbox combination check proves.
    TaxGroup: config.taxGroups.salesTaxGroup as string,
    TAXITEMGROUP: config.taxGroups.itemSalesTaxGroup as string,
    transDate: receipt.transactionDate,
    TRANSACTIONTEXT: part.text,
    DocumentDate: receipt.transactionDate,
    DocumentNum: receipt.invoiceNumber,
    ExchangeRate: rates.exchangeRate,
    ReportingExchangeRate: rates.reportingExchangeRate,
  };
}

function revenueMappingFor(
  config: MasRevenueVerifiedConfig,
  receipt: MasRevenueReceipt,
): MasRevenueAccountMapping {
  const key = normalizeSourceText(receipt.revenueType ?? '');
  const mapping = config.revenueAccountsByRevenueType[key];
  if (!mapping) {
    // Not reachable after the gates; kept as a guard so no account is ever guessed.
    throw new MasRevenueError(`no revenue account for Revenue type "${key}"`);
  }
  return mapping;
}

function vatMappingFor(
  config: MasRevenueVerifiedConfig,
): MasRevenueAccountMapping {
  if (!config.vatAccount) {
    throw new MasRevenueError('no VAT account in configuration');
  }
  return config.vatAccount;
}

function assertNoBlockers(
  config: MasRevenueVerifiedConfig,
  receipts: MasRevenueReceipt[],
): void {
  const blockers = getMasRevenueSubmissionBlockers(config, receipts);
  if (blockers.length > 0) {
    throw new MasRevenueError(`submission is blocked: ${blockers.join('; ')}`);
  }
}

/** Source description text: customer name and invoice number, never truncated silently. */
export function buildTransactionText(receipt: MasRevenueReceipt): string {
  const text = `${receipt.customerName} - ${receipt.invoiceNumber}`;
  if (text.length > MAS_REVENUE_LIMITS.maxTransactionTextLength) {
    throw new MasRevenueError(
      `transaction text for invoice ${receipt.invoiceNumber} is longer than ${MAS_REVENUE_LIMITS.maxTransactionTextLength} characters`,
    );
  }
  return text;
}

/** Converts integer minor units to a two-decimal number. */
export function minorToMajor(minor: number): number {
  return Number((minor / 100).toFixed(2));
}
