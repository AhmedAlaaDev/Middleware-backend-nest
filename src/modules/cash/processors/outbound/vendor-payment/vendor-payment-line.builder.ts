import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { isCashWithholdingLedgerLine } from '@/modules/cash/policies/cash-withholding.policy';
import {
  aggregateVendorPaymentInvoiceLine,
  allocateVendorPaymentWithholdingLines,
  groupVendorPaymentSettlementsByInvoice,
  VendorPaymentSettlement,
} from '@/modules/cash/processors/outbound/vendor-payment';
import { CashOutExchangeRateContext } from '@/modules/cash/services/cash-out-exchange-rate.service';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

import { moneyEquals, moneyRound } from './utils/money.util';

function sourceLineAmount(line: CashEntryRawDataModel): number {
  return Math.max(
    Math.abs(Number(line.CREDITAMOUNT ?? 0)),
    Math.abs(Number(line.DEBITAMOUNT ?? 0)),
  );
}

function paymentOffsetForInvoice(
  paymentOffset: CashEntryRawDataModel,
  amount: number,
): CashEntryRawDataModel {
  return Object.assign(
    Object.create(Object.getPrototypeOf(paymentOffset)),
    paymentOffset,
    {
      CREDITAMOUNT: amount,
      DEBITAMOUNT: 0,
    },
  );
}

function aggregateWithholdingLines(
  lines: CashEntryRawDataModel[],
): CashEntryRawDataModel | undefined {
  const first = lines[0];
  if (!first) return undefined;
  const amount = lines.reduce((sum, line) => sum + sourceLineAmount(line), 0);
  const creditSide = Math.abs(Number(first.CREDITAMOUNT ?? 0)) > 0;
  return Object.assign(Object.create(Object.getPrototypeOf(first)), first, {
    CREDITAMOUNT: creditSide ? amount : 0,
    DEBITAMOUNT: creditSide ? 0 : amount,
  });
}

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
      const paymentOffsetAmount = sourceLineAmount(paymentOffset);
      const withholdingAmount = withholdingLines.reduce(
        (sum, line) => sum + sourceLineAmount(line),
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
      const withholdingAllocation = allocateVendorPaymentWithholdingLines(
        groupLines,
        withholdingLines.filter(
          (candidate) => !claimedWithholdingLines.has(candidate),
        ),
      );
      const settlements = groupLines.map((vendorLine) => {
        const withholdingLine = withholdingAllocation.get(vendorLine);
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

      const invoiceSettlementGroups =
        groupVendorPaymentSettlementsByInvoice(settlements);

      if (!isCustodyVendor) {
        for (const invoiceSettlements of invoiceSettlementGroups) {
          const aggregatedVendorLine =
            aggregateVendorPaymentInvoiceLine(invoiceSettlements);

          if (!hasExplicitWithholding) {
            results.push(
              this.buildVendorLine(
                sourceId,
                aggregatedVendorLine,
                paymentOffset,
                'ACCOUNT',
                exchangeRateContext,
                invoiceSettlements,
                false,
              ),
            );
            continue;
          }

          const currency = String(
            aggregatedVendorLine.CURRENCYCODE || paymentOffset.CURRENCYCODE || '',
          );
          const withholdingLine = aggregateWithholdingLines(
            [
              ...new Set(
                invoiceSettlements
                  .map((settlement) => settlement.withholdingLine)
                  .filter(
                    (line): line is CashEntryRawDataModel => Boolean(line),
                  ),
              ),
            ],
          );
          const withholdingAmount = withholdingLine
            ? sourceLineAmount(withholdingLine)
            : 0;
          const invoicePaymentAmount = moneyRound(
            Number(aggregatedVendorLine.DEBITAMOUNT ?? 0) - withholdingAmount,
            currency,
          );

          if (invoicePaymentAmount < 0) {
            const invalid = new CashEntryDynDataModel(
              new EntryDimensionsModel(),
              {
                SourceIds: [sourceId],
                SafeType: 'Vendor Payment',
              },
            );
            invalid.AddError(
              'WithholdingAllocation',
              `Vendor Payment invoice ${String(aggregatedVendorLine.INVOICE ?? '').trim()} has withholding ${withholdingAmount} greater than its Vendor amount ${aggregatedVendorLine.DEBITAMOUNT}.`,
            );
            return [invalid];
          }

          const settlementTarget: VendorPaymentSettlement = {
            vendorLine: aggregatedVendorLine,
            withholdingLine,
          };

          // The false-flag 223304 portion must be marked before the true-flag
          // main portion. The latter is allowed to extend the current invoice
          // settlement in the same X++ TTS; reversing the order leaves the
          // companion silently unmarked.
          if (withholdingLine) {
            results.push(
              this.buildVendorLine(
                sourceId,
                aggregatedVendorLine,
                withholdingLine,
                'OFFSET',
                exchangeRateContext,
                [settlementTarget],
                true,
              ),
            );
          }
          results.push(
            this.buildVendorLine(
              sourceId,
              aggregatedVendorLine,
              paymentOffsetForInvoice(paymentOffset, invoicePaymentAmount),
              'OFFSET',
              exchangeRateContext,
              [settlementTarget],
              true,
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

      // Each explicit custody withholding source row becomes its own Vendor -> Ledger
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
