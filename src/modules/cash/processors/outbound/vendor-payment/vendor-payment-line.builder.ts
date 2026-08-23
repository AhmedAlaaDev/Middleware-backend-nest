import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { isCashWithholdingLedgerLine } from '@/modules/cash/policies/cash-withholding.policy';
import {
  aggregateVendorPaymentInvoiceLine,
  findVendorPaymentWithholdingLine,
  groupVendorPaymentSettlementsByInvoice,
  VendorPaymentSettlement,
} from '@/modules/cash/processors/outbound/vendor-payment';
import { CashOutExchangeRateContext } from '@/modules/cash/services/cash-out-exchange-rate.service';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

import { moneyEquals } from './utils/money.util';

type BuildVendorLine = (
  sourceId: string,
  accountLine: CashEntryRawDataModel,
  offsetLine: CashEntryRawDataModel,
  amountSource: 'ACCOUNT' | 'OFFSET',
  exchangeRateContext: CashOutExchangeRateContext | undefined,
  settlements: VendorPaymentSettlement[],
  disableAutomaticWithholdingCalculation: boolean,
) => CashEntryDynDataModel;

/** Builds one Cash-Out Vendor Payment group from raw source rows. */
export class VendorPaymentLineBuilder {
  constructor(private readonly buildVendorLine: BuildVendorLine) {}

  build(
    sourceId: string,
    lines: CashEntryRawDataModel[],
    exchangeRateContext?: CashOutExchangeRateContext,
  ): CashEntryDynDataModel[] {
    const withholdingLines = lines.filter(isCashWithholdingLedgerLine);
    const vendorLines = lines.filter(
      (line) => line.IsVendor && Number(line.DEBITAMOUNT) > 0,
    );
    const offsetLines = lines.filter(
      (line) =>
        Number(line.CREDITAMOUNT) > 0 && !isCashWithholdingLedgerLine(line),
    );

    if (vendorLines.length === 0 || offsetLines.length !== 1) {
      const invalid = new CashEntryDynDataModel(new EntryDimensionsModel(), {
        SourceIds: [sourceId],
        SafeType: 'Vendor Payment',
      });
      invalid.AddError(
        'InvalidMapping',
        `Vendor Payment requires one payment offset and one or more debit Vendor lines. Found ${vendorLines.length} Vendor line(s) and ${offsetLines.length} payment offset(s).`,
      );
      return [invalid];
    }

    const paymentOffset = offsetLines[0];

    // Explicit withholding is posted as a second Vendor -> 223304 line. The
    // main Vendor line owns only the payment-offset amount, while the companion
    // owns only the withholding amount. Together they must reconcile to the
    // gross Vendor debit from the source; otherwise marking the two partial
    // amounts would settle an incorrect total.
    if (withholdingLines.length > 0) {
      const vendorDebitTotal = vendorLines.reduce(
        (sum, line) => sum + Number(line.DEBITAMOUNT ?? 0),
        0,
      );
      const paymentOffsetAmount = Number(paymentOffset.CREDITAMOUNT ?? 0);
      const withholdingAmount = withholdingLines.reduce(
        (sum, line) => sum + Number(line.CREDITAMOUNT || line.DEBITAMOUNT || 0),
        0,
      );
      const currency = String(
        paymentOffset.CURRENCYCODE || vendorLines[0]?.CURRENCYCODE || '',
      );

      if (
        !moneyEquals(
          vendorDebitTotal,
          paymentOffsetAmount + withholdingAmount,
          currency,
        )
      ) {
        const invalid = new CashEntryDynDataModel(new EntryDimensionsModel(), {
          SourceIds: [sourceId],
          SafeType: 'Vendor Payment',
        });
        invalid.AddError(
          'WithholdingBalance',
          `Vendor Payment amounts do not reconcile: Vendor total ${vendorDebitTotal}, payment offset ${paymentOffsetAmount}, withholding ${withholdingAmount}. Expected Vendor total = payment offset + withholding.`,
        );
        return [invalid];
      }
    }

    const vendorGroups = new Map<string, CashEntryRawDataModel[]>();
    for (const vendorLine of vendorLines) {
      const key = [
        String(vendorLine.ACCOUNTDISPLAYVALUE ?? '')
          .trim()
          .toLowerCase(),
        String(vendorLine.VendorGroup ?? '')
          .trim()
          .toLowerCase(),
      ].join('|');
      const group = vendorGroups.get(key) ?? [];
      group.push(vendorLine);
      vendorGroups.set(key, group);
    }

    const results: CashEntryDynDataModel[] = [];
    const claimedWithholdingLines = new Set<CashEntryRawDataModel>();

    for (const groupLines of vendorGroups.values()) {
      const settlements = groupLines.map((vendorLine) => {
        const withholdingLine = findVendorPaymentWithholdingLine(
          vendorLine,
          withholdingLines.filter(
            (candidate) => !claimedWithholdingLines.has(candidate),
          ),
        );
        if (withholdingLine) claimedWithholdingLines.add(withholdingLine);
        return { vendorLine, withholdingLine };
      });
      const hasExplicitWithholding = settlements.some(({ withholdingLine }) =>
        Boolean(withholdingLine),
      );
      const isCustodyVendor =
        String(groupLines[0]?.VendorGroup ?? '')
          .trim()
          .toLowerCase() === 'custody';

      if (!hasExplicitWithholding && !isCustodyVendor) {
        for (const invoiceSettlements of groupVendorPaymentSettlementsByInvoice(
          settlements,
        )) {
          results.push(
            this.buildVendorLine(
              sourceId,
              aggregateVendorPaymentInvoiceLine(invoiceSettlements),
              paymentOffset,
              'ACCOUNT',
              exchangeRateContext,
              invoiceSettlements,
              false,
            ),
          );
        }
        continue;
      }

      // The source payment row already contains the cash/bank amount. Do not
      // calculate it by subtracting withholding from the vendor debit.
      results.push(
        this.buildVendorLine(
          sourceId,
          groupLines[0],
          paymentOffset,
          'OFFSET',
          exchangeRateContext,
          settlements,
          hasExplicitWithholding,
        ),
      );

      // Each explicit withholding source row becomes its own Vendor -> Ledger
      // journal line. Its amount is copied from that row, never calculated.
      // It carries the same settlement identity as the paired payment line so
      // D365 can mark the withholding portion against the same invoice.
      for (const settlement of settlements) {
        if (!settlement.withholdingLine) continue;
        results.push(
          this.buildVendorLine(
            sourceId,
            settlement.vendorLine,
            settlement.withholdingLine,
            'OFFSET',
            exchangeRateContext,
            [settlement],
            true,
          ),
        );
      }
    }

    const unmatchedWithholding = withholdingLines.filter(
      (line) => !claimedWithholdingLines.has(line),
    );
    if (unmatchedWithholding.length > 0) {
      const invalid = new CashEntryDynDataModel(new EntryDimensionsModel(), {
        SourceIds: [sourceId],
        SafeType: 'Vendor Payment',
      });
      invalid.AddError(
        'WithholdingAllocation',
        `Vendor Payment contains ${unmatchedWithholding.length} withholding line(s) that could not be matched to a Vendor invoice.`,
      );
      return [invalid];
    }

    return results;
  }
}
