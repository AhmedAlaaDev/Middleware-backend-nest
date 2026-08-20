import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { isCashSettlementLine } from '@/modules/cash/policies/cash-account.policy';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

/** Separates settlement rows while preserving the order of both outputs. */
export function filterCashSettlementLines(
  lines: CashEntryRawDataModel[],
  settlementSink: CashEntryRawDataModel[],
  parseDimensions: (displayValue?: string) => EntryDimensionsModel,
): CashEntryRawDataModel[] {
  const withoutSettlement: CashEntryRawDataModel[] = [];
  for (const line of lines) {
    const dimensions = parseDimensions(line.ACCOUNTDISPLAYVALUE);
    if (isCashSettlementLine(line, dimensions.mainAccount)) {
      settlementSink.push(line);
    } else {
      withoutSettlement.push(line);
    }
  }
  return withoutSettlement;
}

/** Selects source PAYMENTMETHOD, preferring the transaction row. */
export function resolveCashPaymentMethod(
  accountLine: CashEntryRawDataModel,
  offsetLine: CashEntryRawDataModel,
): string {
  return (
    [accountLine.PAYMENTMETHOD, offsetLine.PAYMENTMETHOD]
      .map((value) => value?.trim() ?? '')
      .find(Boolean) ?? ''
  );
}
