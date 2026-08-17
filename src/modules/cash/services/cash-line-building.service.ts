import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashOutExchangeRateContext } from '@/modules/cash/services/cash-out-exchange-rate.service';

export type CashInvoiceLineMap = Map<string, CashEntryRawDataModel[]>;

/**
 * Builds all D365FO lines in the insertion order of the grouped invoice map.
 * The callbacks remain responsible for the existing business-specific builders.
 */
export function buildCashInvoiceLines(options: {
  invoiceMap: CashInvoiceLineMap;
  buildGroupedLines: (
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ) => CashEntryDynDataModel[];
  exchangeRateContext?: CashOutExchangeRateContext;
}): CashEntryDynDataModel[] {
  const dfoLines: CashEntryDynDataModel[] = [];

  for (const [sourceId, lines] of options.invoiceMap.entries()) {
    dfoLines.push(
      ...options.buildGroupedLines(
        sourceId,
        lines,
        options.exchangeRateContext,
      ),
    );
  }

  return dfoLines;
}

/**
 * Dispatches one grouped cash invoice to the correct builder.
 * This service owns only routing; the existing line-building implementations
 * remain unchanged behind callbacks.
 */
export function buildCashLines(options: {
  sourceId: string;
  lines: CashEntryRawDataModel[];
  inbound: boolean;
  exchangeRateContext?: CashOutExchangeRateContext;
  buildVendorPayment: (
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ) => CashEntryDynDataModel[];
  buildSourceOutbound: (
    sourceId: string,
    line: CashEntryRawDataModel,
    exchangeRateContext?: CashOutExchangeRateContext,
  ) => CashEntryDynDataModel;
  buildTwoLines: (
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ) => CashEntryDynDataModel[];
  buildManyLines: (
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ) => CashEntryDynDataModel[];
}): CashEntryDynDataModel[] {
  const {
    sourceId,
    lines,
    inbound,
    exchangeRateContext,
    buildVendorPayment,
    buildSourceOutbound,
    buildTwoLines,
    buildManyLines,
  } = options;

  if (!inbound) {
    const safeTypes = new Set(lines.map((line) => line.SafeType));
    if (safeTypes.size === 1 && lines[0]?.IsVendorPayment) {
      return buildVendorPayment(sourceId, lines, exchangeRateContext);
    }
    return lines.map((line) =>
      buildSourceOutbound(sourceId, line, exchangeRateContext),
    );
  }

  return lines.length === 2
    ? buildTwoLines(sourceId, lines, exchangeRateContext)
    : buildManyLines(sourceId, lines, exchangeRateContext);
}
