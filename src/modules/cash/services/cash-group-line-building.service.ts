import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { filterCashSettlementLines } from '@/modules/cash/policies/cash-line.policy';
import { CashOutExchangeRateContext } from '@/modules/cash/services/cash-out-exchange-rate.service';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

type AmountSource = 'ACCOUNT' | 'OFFSET';

type BuildLine = (
  sourceId: string,
  accountLine?: CashEntryRawDataModel,
  offsetLine?: CashEntryRawDataModel,
  amountSource?: AmountSource,
  exchangeRateContext?: CashOutExchangeRateContext,
) => CashEntryDynDataModel;

/** Selects the direction-specific formatter without changing its arguments. */
export function buildCashLine(options: {
  inbound: boolean;
  sourceId: string;
  accountLine?: CashEntryRawDataModel;
  offsetLine?: CashEntryRawDataModel;
  amountSource?: AmountSource;
  exchangeRateContext?: CashOutExchangeRateContext;
  buildInbound: BuildLine;
  buildOutbound: BuildLine;
}): CashEntryDynDataModel {
  const {
    inbound,
    sourceId,
    accountLine,
    offsetLine,
    amountSource,
    exchangeRateContext,
    buildInbound,
    buildOutbound,
  } = options;
  const build = inbound ? buildInbound : buildOutbound;

  return build(
    sourceId,
    accountLine,
    offsetLine,
    amountSource ?? 'OFFSET',
    exchangeRateContext,
  );
}

/**
 * Builds grouped Cash-In/Cash-Out lines for the two supported group shapes.
 * Direction-specific line formatting stays behind the buildLine callback.
 */
export function buildCashTwoLines(options: {
  sourceId: string;
  lines: CashEntryRawDataModel[];
  inbound: boolean;
  exchangeRateContext?: CashOutExchangeRateContext;
  buildLine: BuildLine;
}): CashEntryDynDataModel[] {
  const { sourceId, lines, inbound, exchangeRateContext, buildLine } = options;
  const accountLine = inbound
    ? lines.find((line) => line.IsCustomer)
    : lines.find((line) => line.DEBITAMOUNT > 0);
  const offsetLine = inbound
    ? lines.find((line) => !line.IsCustomer)
    : lines.find((line) => line.CREDITAMOUNT > 0);

  return [
    buildLine(
      sourceId,
      accountLine,
      offsetLine,
      undefined,
      exchangeRateContext,
    ),
  ];
}

/**
 * Builds groups containing more than two source lines, including the existing
 * settlement-offset filtering and invalid-shape fallback behavior.
 */
export function buildCashMoreThanTwoLines(options: {
  sourceId: string;
  lines: CashEntryRawDataModel[];
  inbound: boolean;
  exchangeRateContext?: CashOutExchangeRateContext;
  buildLine: BuildLine;
  parseDimensionString: (displayValue?: string) => EntryDimensionsModel;
}): CashEntryDynDataModel[] {
  const {
    sourceId,
    lines,
    inbound,
    exchangeRateContext,
    buildLine,
    parseDimensionString,
  } = options;
  const accountLines = inbound
    ? lines.filter((line) => line.IsCustomer)
    : lines.filter((line) => line.DEBITAMOUNT > 0);
  const offsetLines = inbound
    ? lines.filter((line) => !line.IsCustomer)
    : lines.filter((line) => line.CREDITAMOUNT > 0);
  const settlementSink: CashEntryRawDataModel[] = [];

  if (accountLines.length > 1 && offsetLines.length === 1) {
    return accountLines.map((accountLine) =>
      buildLine(
        sourceId,
        accountLine,
        offsetLines[0],
        'ACCOUNT',
        exchangeRateContext,
      ),
    );
  }

  if (accountLines.length === 1 && offsetLines.length > 1) {
    const filteredOffsetLines = filterCashSettlementLines(
      offsetLines,
      settlementSink,
      (displayValue) => parseDimensionString(displayValue),
    );

    return filteredOffsetLines.map((offsetLine) =>
      buildLine(
        sourceId,
        accountLines[0],
        offsetLine,
        'OFFSET',
        exchangeRateContext,
      ),
    );
  }

  return [
    buildLine(sourceId, undefined, undefined, undefined, exchangeRateContext),
  ];
}
