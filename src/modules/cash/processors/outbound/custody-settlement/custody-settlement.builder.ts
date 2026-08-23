import { prepareCustodySettlementLines } from './custody-settlement.processor';

import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { firstCashFinancialTag } from '@/modules/cash/policies/cash-invoice.policy';
import { CashOutExchangeRateContext } from '@/modules/cash/services/cash-out-exchange-rate.service';

type BuildSourceLine = (
  sourceId: string,
  line: CashEntryRawDataModel,
  exchangeRateContext?: CashOutExchangeRateContext,
) => CashEntryDynDataModel;

/** Builder for the Cash-Out Custody Settlement output lines. */
export class CustodySettlementBuilder {
  constructor(private readonly buildSourceLine: BuildSourceLine) {}

  build(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    return prepareCustodySettlementLines(lines).map((plan) => {
      const dynLine = this.buildSourceLine(
        sourceId,
        plan.line,
        exchangeRateContext,
      );

      if (plan.isVendorLine) {
        const sourceInvoice =
          [plan.line.MARKEDINVOICE, plan.line.INVOICE]
            .map((value) => String(value ?? '').trim())
            .find((value) => Boolean(value) && value !== '0') ?? '';
        const isCustodyLedger =
          Boolean(plan.line.IsCustodyVendor) ||
          Number(plan.line.CREDITAMOUNT ?? 0) > 0;
        // Invoice is display metadata; MarkedLines alone controls settlement.
        // Preserve it so an intentionally unmarked line remains traceable.
        dynLine.Invoice = sourceInvoice;
        if (isCustodyLedger) {
          const documentNumber = String(plan.line.DOCUMENT ?? '').trim();
          const operationNumber = firstCashFinancialTag(
            plan.line.FINTAGDISPLAYVALUE,
          );
          dynLine.MarkedInvoice = '';
          dynLine.MarkedLines = documentNumber
            ? [
                {
                  InvoiceNumber: String(
                    plan.line.ResolvedD365InvoiceNumber ?? '',
                  ),
                  OperationNumber: operationNumber,
                  DocumentNumber: documentNumber,
                  HasWithHoldingLine: Boolean(
                    plan.markedLines[0]?.HasWithHoldingLine,
                  ),
                },
              ]
            : [];
        } else {
          dynLine.MarkedInvoice = plan.markedInvoice;
          dynLine.MarkedLines = [...plan.markedLines];
        }
        dynLine.SettlementIntent =
          dynLine.MarkedLines.length > 0 ? 'Marked' : 'Unmarked';
        if (dynLine.SettlementIntent === 'Unmarked') {
          const description = sourceInvoice
            ? `Unmarked - ${sourceInvoice}`
            : 'Unmarked';
          dynLine.Description = description;
          dynLine.TransactionText = description;
        }
        dynLine.SettlementTargetType = isCustodyLedger
          ? 'CustodyLedger'
          : 'VendorInvoice';
      }

      // The policy has already deducted withholding from the line amount.
      dynLine.IsWithholdingCalculationEnabled = 'No';
      dynLine.ItemWithholdingTaxGroupCode = '';
      return dynLine;
    });
  }
}
