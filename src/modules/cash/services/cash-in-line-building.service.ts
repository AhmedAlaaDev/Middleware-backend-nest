import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { isCash22420LedgerDimensionLine } from '@/modules/cash/policies/cash-account.policy';
import { formatCashInboundInvoice } from '@/modules/cash/policies/cash-invoice.policy';
import { toCashDefaultDimensionDisplayValue } from '@/modules/cash/policies/cash-dimension.policy';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';
import {
  CashOutExchangeRateContext,
  CashOutExchangeRateResolution,
} from '@/modules/cash/services/cash-out-exchange-rate.service';

export function resolveCashInboundRates(options: {
  exchangeRateContext?: CashOutExchangeRateContext;
  transactionDate?: string;
  currencyCode?: string;
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
  const legacyRates = options.fetchLegacyRates(
    options.transactionDate,
    options.currencyCode,
  );

  return {
    exchangeRate: legacyRates.exchangeRate,
    reportingRate: reportingResolution
      ? reportingResolution.rate
      : legacyRates.reportingRate,
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
  transactionDate?: string;
  markedInvoice: string;
} {
  const { accountLine, offsetLine, dimensions, amountSource } = options;
  return {
    dimensionDisplayValue: toCashDefaultDimensionDisplayValue(
      dimensions,
      !isCash22420LedgerDimensionLine(accountLine, offsetLine),
    ),
    currencyCode:
      amountSource === 'ACCOUNT'
        ? accountLine.CURRENCYCODE
        : offsetLine.CURRENCYCODE,
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
} {
  const { accountLine, offsetLine } = options;
  const dimensionString =
    offsetLine?.ACCOUNTTYPE === 'Ledger'
      ? offsetLine.ACCOUNTDISPLAYVALUE
      : accountLine?.DEFAULTDIMENSIONDISPLAYVALUE;
  const segmentLength = options.getDimensionSegmentLength(dimensionString);
  let dimensions = options.parseDimensionString(dimensionString);

  dimensions = isCash22420LedgerDimensionLine(accountLine, offsetLine)
    ? options.filterDimensionsForLedgerTag22420(dimensions)
    : dimensions;

  return { dimensionString, segmentLength, dimensions };
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
  if (!offsetLine) {
    line.AddError('InvalidMapping', 'No offset line found');
  }

  return line;
}
