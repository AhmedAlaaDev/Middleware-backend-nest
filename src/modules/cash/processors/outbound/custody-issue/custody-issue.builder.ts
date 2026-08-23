import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashOutExchangeRateContext } from '@/modules/cash/services/cash-out-exchange-rate.service';
import { prepareCustodyIssueLines } from './custody-issue.processor';

type BuildSourceLine = (
  sourceId: string,
  line: CashEntryRawDataModel,
  exchangeRateContext?: CashOutExchangeRateContext,
) => CashEntryDynDataModel;

/**
 * Builder for Cash-Out Custody Issue lines.
 *
 * Existing behavior is intentionally one source row to one output line; all
 * common dimension, 22420, currency, and journal-field rules remain in the
 * shared source-line builder supplied by the base processor.
 */
export class CustodyIssueBuilder {
  constructor(private readonly buildSourceLine: BuildSourceLine) {}

  build(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    return prepareCustodyIssueLines(lines).map((plan) =>
      this.buildSourceLine(sourceId, plan.line, exchangeRateContext),
    );
  }
}
