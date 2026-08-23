import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashOutExchangeRateContext } from '@/modules/cash/services/cash-out-exchange-rate.service';

export interface CashOutBuildStrategy {
  build(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[];
}

type BuildSourceLine = (
  sourceId: string,
  line: CashEntryRawDataModel,
  exchangeRateContext?: CashOutExchangeRateContext,
) => CashEntryDynDataModel;

/**
 * Single Cash-Out builder facade. It selects a feature strategy but owns no
 * Vendor Payment, Custody Settlement, or Custody Issue business rules.
 */
export class CashOutEntryBuilder {
  constructor(
    private readonly vendorPayment: CashOutBuildStrategy,
    private readonly custodySettlement: CashOutBuildStrategy,
    private readonly custodyIssue: CashOutBuildStrategy,
    private readonly buildSourceLine: BuildSourceLine,
  ) {}

  build(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    const safeTypes = new Set(lines.map((line) => line.SafeType));
    if (safeTypes.size === 1 && lines[0]?.IsVendorPayment) {
      return this.vendorPayment.build(sourceId, lines, exchangeRateContext);
    }
    if (lines.some((line) => line.IsCustodySettlement)) {
      return this.custodySettlement.build(sourceId, lines, exchangeRateContext);
    }
    if (lines.some((line) => line.IsCustodyIssue)) {
      return this.custodyIssue.build(sourceId, lines, exchangeRateContext);
    }
    return lines.map((line) =>
      this.buildSourceLine(sourceId, line, exchangeRateContext),
    );
  }
}
