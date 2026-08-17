import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

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
