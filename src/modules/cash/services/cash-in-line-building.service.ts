import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { isCash22420LedgerDimensionLine } from '@/modules/cash/policies/cash-account.policy';
import { resolveCashInboundCustomerCurrency } from '@/modules/cash/policies/cash-currency.policy';
import {
  sanitizeCashBankAccountDimension,
  toCashDefaultDimensionDisplayValue,
} from '@/modules/cash/policies/cash-dimension.policy';
import { formatCashInboundInvoice } from '@/modules/cash/policies/cash-invoice.policy';
import {
  CashOutExchangeRateContext,
  CashOutExchangeRateResolution,
} from '@/modules/cash/services/cash-out-exchange-rate.service';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

/** Cash-In source alias for the EUR working-capital ledger account. */
export function isCashInWcaEuBankLine(
  line?: CashEntryRawDataModel,
): boolean {
  if (!line) return false;
  const accountType = String(line.ACCOUNTTYPE ?? '').trim().toLowerCase();
  const account = String(line.ACCOUNTDISPLAYVALUE ?? '')
    .trim()
    .toUpperCase()
    .split('|')[0]
    ?.trim();
  return accountType === 'bank' && account === 'WCA-EU';
}

/** Builds the stable Cash-In marked-line contract from the inbound source. */
export function buildCashInboundMarkedLines(
  accountLine: CashEntryRawDataModel,
  offsetLine: CashEntryRawDataModel,
  markedInvoice: string,
): CashEntryDynDataModel['MarkedLines'] {
  const invoiceNumber = String(markedInvoice ?? '').trim();
  if (!invoiceNumber) return [];

  return [
    {
      InvoiceNumber: invoiceNumber,
      OperationNumber: '',
      DocumentNumber: String(
        accountLine.DOCUMENT || offsetLine.DOCUMENT || '',
      ).trim(),
      HasWithHoldingLine: false,
    },
  ];
}

export function resolveCashInboundRates(options: {
  exchangeRateContext?: CashOutExchangeRateContext;
  transactionDate?: string;
  currencyCode?: string;
  resolveTransaction: (
    context: CashOutExchangeRateContext,
    transactionDate?: string,
    currencyCode?: string,
  ) => CashOutExchangeRateResolution;
  resolveReporting: (
    context: CashOutExchangeRateContext,
    transactionDate?: string,
    currencyCode?: string,
  ) => CashOutExchangeRateResolution;
  fetchLegacyRates: (
    transactionDate?: string,
    currencyCode?: string,
  ) => { exchangeRate: number; reportingRate: number };
}): { exchangeRate: number; reportingRate: number } {
  const reportingResolution = options.exchangeRateContext
    ? options.resolveReporting(
        options.exchangeRateContext,
        options.transactionDate,
        options.currencyCode,
      )
    : undefined;
  const transactionResolution = options.exchangeRateContext
    ? options.resolveTransaction(
        options.exchangeRateContext,
        options.transactionDate,
        options.currencyCode,
      )
    : undefined;
  const legacyRates = transactionResolution
    ? undefined
    : options.fetchLegacyRates(
        options.transactionDate,
        options.currencyCode,
      );

  return {
    exchangeRate: transactionResolution?.rate ?? legacyRates!.exchangeRate,
    reportingRate: reportingResolution
      ? reportingResolution.rate
      : legacyRates!.reportingRate,
  };
}

export function formatCashInboundDescription(options: {
  accountLine: CashEntryRawDataModel;
  offsetLine: CashEntryRawDataModel;
  isNotesReceivable: boolean;
  label: string;
  formattedDate: string;
}): { description: string; paymentReference: string } {
  const { accountLine, offsetLine, isNotesReceivable, label, formattedDate } =
    options;
  const description = `Customer Collection - ${label} ${formattedDate} (${accountLine.VoucherType})`;
  const paymentReference = isNotesReceivable
    ? offsetLine.PAYMENTREFERENCE || `${offsetLine.DESCRIPTION} - ${label}`
    : offsetLine.DESCRIPTION || '';

  return { description, paymentReference };
}

export function resolveCashInboundDerivedValues(options: {
  accountLine: CashEntryRawDataModel;
  offsetLine: CashEntryRawDataModel;
  dimensions: EntryDimensionsModel;
  amountSource?: 'ACCOUNT' | 'OFFSET';
}): {
  dimensionDisplayValue: string;
  currencyCode?: string;
  currencyChanged: boolean;
  previousCustomerCurrencyCode: string;
  transactionDate?: string;
  markedInvoice: string;
} {
  const { accountLine, offsetLine, dimensions } = options;
  // The non-customer (offset) line is the source of truth for the
  // transaction currency: the customer line always inherits it when the two
  // differ, regardless of which side the amount is sourced from.
  const currencyResolution = resolveCashInboundCustomerCurrency(
    accountLine,
    offsetLine,
  );

  return {
    dimensionDisplayValue: toCashDefaultDimensionDisplayValue(
      dimensions,
      !isCash22420LedgerDimensionLine(accountLine, offsetLine),
    ),
    currencyCode: currencyResolution.currencyCode,
    currencyChanged: currencyResolution.changed,
    previousCustomerCurrencyCode: currencyResolution.previousCurrencyCode,
    transactionDate: offsetLine.TRANSDATE || accountLine.TRANSDATE,
    markedInvoice: formatCashInboundInvoice(
      accountLine.INVOICE ||
        offsetLine.INVOICE ||
        accountLine.DOCUMENT ||
        offsetLine.DOCUMENT,
    ),
  };
}

export function prepareCashInboundDimensions(options: {
  accountLine?: CashEntryRawDataModel;
  offsetLine?: CashEntryRawDataModel;
  getDimensionSegmentLength: (displayValue?: string) => number;
  parseDimensionString: (displayValue?: string) => EntryDimensionsModel;
  filterDimensionsForLedgerTag22420: (
    dimensions: EntryDimensionsModel,
  ) => EntryDimensionsModel;
}): {
  dimensionString?: string;
  segmentLength: number;
  dimensions: EntryDimensionsModel;
  clearedBankAccountDimension: string;
} {
  const { accountLine, offsetLine } = options;
  const dimensionString =
    offsetLine?.ACCOUNTTYPE === 'Ledger'
      ? offsetLine.ACCOUNTDISPLAYVALUE
      : offsetLine?.DEFAULTDIMENSIONDISPLAYVALUE ||
        accountLine?.DEFAULTDIMENSIONDISPLAYVALUE;
  const segmentLength = options.getDimensionSegmentLength(dimensionString);
  let dimensions = options.parseDimensionString(dimensionString);

  dimensions = isCash22420LedgerDimensionLine(accountLine, offsetLine)
    ? options.filterDimensionsForLedgerTag22420(dimensions)
    : dimensions;

  // A `BankAccount` financial-dimension value that duplicates a main account
  // (or matches a known Ledger-only main account) can never resolve against
  // `BankAccountTable` in D365FO, and must be cleared before it reaches the
  // dimension combination sent to D365FO.
  let clearedBankAccountDimension =
    sanitizeCashBankAccountDimension(dimensions);

  if (
    (isCashInWcaEuBankLine(accountLine) || isCashInWcaEuBankLine(offsetLine)) &&
    String(dimensions.bankAccount ?? '').trim().toUpperCase() === 'WCA-EU'
  ) {
    clearedBankAccountDimension = String(dimensions.bankAccount).trim();
    dimensions.bankAccount = undefined;
  }

  return {
    dimensionString,
    segmentLength,
    dimensions,
    clearedBankAccountDimension,
  };
}

/** Builds the unchanged invalid-mapping result used by Cash-In line formatting. */
export function buildCashInboundInvalidLine(
  sourceId: string,
  accountLine: CashEntryRawDataModel | undefined,
  offsetLine: CashEntryRawDataModel | undefined,
  dimensions: any,
): CashEntryDynDataModel {
  const line = new CashEntryDynDataModel(dimensions, {
    SourceIds: [sourceId],
  });

  if (!accountLine) {
    line.AddError('InvalidMapping', 'No account line found');
  }
  if (accountLine && !offsetLine) {
    line.AddError(
      'InvalidMapping',
      'Unable to determine the corresponding non-customer line for the customer transaction.',
    );
  } else if (!offsetLine) {
    line.AddError('InvalidMapping', 'No offset line found');
  }

  return line;
}

/** Creates the Cash-In dynamic model without altering its payload defaults. */
export function createCashInboundDynamicLine(
  dimensions: EntryDimensionsModel,
  data: Partial<CashEntryDynDataModel>,
): CashEntryDynDataModel {
  return new CashEntryDynDataModel(dimensions, data);
}
