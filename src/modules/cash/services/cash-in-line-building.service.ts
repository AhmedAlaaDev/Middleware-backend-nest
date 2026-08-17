import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { isCash22420LedgerDimensionLine } from '@/modules/cash/policies/cash-account.policy';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

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
