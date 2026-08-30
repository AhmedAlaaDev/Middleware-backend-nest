import {
  findCustodySettlementWithholdingLine,
  resolveCustodySettlementMarking,
} from './custody-settlement-marking.policy';

import { CashEntryMarkedLine } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { isCashWithholdingLedgerLine } from '@/modules/cash/policies/cash-withholding.policy';

export interface CustodySettlementLinePlan {
  line: CashEntryRawDataModel;
  isVendorLine: boolean;
  markedInvoice: string;
  markedLines: readonly CashEntryMarkedLine[];
}

/**
 * Owns Cash-Out Custody Settlement preparation.
 *
 * Custody Settlement keeps its existing business rules:
 * - withholding is deducted from the main vendor debit;
 * - each matched 223304 row is emitted as a Vendor -> Ledger companion;
 * - MarkedLines only flags withholding matched to that vendor source row;
 * - offsets are cleared on the main custody rows;
 * - each matched withholding row becomes a separate Vendor -> Ledger output
 *   line, preserving the same settlement identity shape as Vendor Payment.
 *
 * It deliberately does not decide the journal family. Routing remains in the
 * shared cash routing service so Cash-Out continues to post through the
 * configured Finance vendor-payment journal.
 */
export function prepareCustodySettlementLines(
  lines: CashEntryRawDataModel[],
): CustodySettlementLinePlan[] {
  const withholdingLines = lines.filter(isCashWithholdingLedgerLine);
  const nonWithholdingLines = lines.filter(
    (line) => !isCashWithholdingLedgerLine(line),
  );
  const consumedWithholdingLines = new Set<CashEntryRawDataModel>();
  const plans: CustodySettlementLinePlan[] = [];

  for (const rawLine of nonWithholdingLines) {
    const accountType = String(rawLine.ACCOUNTTYPE ?? '')
      .trim()
      .toLowerCase();
    const isVendorLine =
      Boolean(rawLine.IsVendor) ||
      accountType === 'vend' ||
      accountType === 'vendor';
    const line = cloneCashSettlementLine(rawLine);

    const withholdingLine =
      isVendorLine && Number(line.DEBITAMOUNT || 0) > 0
        ? findCustodySettlementWithholdingLine(line, withholdingLines)
        : undefined;
    if (withholdingLine) consumedWithholdingLines.add(withholdingLine);

    // Keep the existing net vendor amount. The matching withholding row is
    // emitted below as a separate Vendor -> Ledger companion, exactly like the
    // Vendor Payment flow, so the journal remains balanced.
    if (isVendorLine && withholdingLine && Number(line.DEBITAMOUNT || 0) > 0) {
      line.DEBITAMOUNT = Math.max(
        0,
        Number(line.DEBITAMOUNT || 0) -
          custodyWithholdingAmount(withholdingLine),
      );
    }

    clearCustodySettlementOffset(line);

    if (!isVendorLine) {
      plans.push({
        line,
        isVendorLine,
        markedInvoice: '',
        markedLines: [],
      });
      continue;
    }

    const marking = resolveCustodySettlementMarking({
      vendorLine: line,
      withholdingLine,
    });

    plans.push({
      line,
      isVendorLine,
      markedInvoice: marking.markedInvoice,
      markedLines: marking.markedLines,
    });

    if (withholdingLine) {
      const companion = buildCustodyWithholdingCompanion(line, withholdingLine);
      const companionMarking = resolveCustodySettlementMarking({
        vendorLine: companion,
      });
      plans.push({
        line: companion,
        isVendorLine: true,
        markedInvoice: companionMarking.markedInvoice,
        markedLines: companionMarking.markedLines,
      });
    }
  }

  // A malformed source group must not silently lose a withholding row. There
  // is no vendor identity to build a companion from, so preserve the original
  // ledger row and let normal account validation report any invalid shape.
  for (const withholdingLine of withholdingLines) {
    if (consumedWithholdingLines.has(withholdingLine)) continue;
    const line = cloneCashSettlementLine(withholdingLine);
    clearCustodySettlementOffset(line);
    plans.push({
      line,
      isVendorLine: false,
      markedInvoice: '',
      markedLines: [],
    });
  }

  return plans;
}

function custodyWithholdingAmount(line: CashEntryRawDataModel): number {
  const credit = Number(line.CREDITAMOUNT ?? 0);
  if (credit !== 0) return Math.abs(credit);
  return Math.abs(Number(line.DEBITAMOUNT ?? 0));
}

function cloneCashSettlementLine(
  source: CashEntryRawDataModel,
): CashEntryRawDataModel {
  return Object.assign(
    Object.create(Object.getPrototypeOf(source)),
    source,
  ) as CashEntryRawDataModel;
}

function clearCustodySettlementOffset(line: CashEntryRawDataModel): void {
  line.OFFSETACCOUNTTYPE = '' as any;
  line.OFFSETACCOUNTDISPLAYVALUE = '';
  line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE = '';
  line.OFFSETFINTAGDISPLAYVALUE = '';
}

/**
 * Converts the source 223304 ledger row into the same Vendor -> Ledger
 * companion line emitted by Vendor Payment. The vendor invoice/document stay
 * on the companion mark, while HasWithHoldingLine is false because this row is
 * the withholding transaction itself.
 */
function buildCustodyWithholdingCompanion(
  vendorLine: CashEntryRawDataModel,
  withholdingLine: CashEntryRawDataModel,
): CashEntryRawDataModel {
  const companion = cloneCashSettlementLine(vendorLine);
  const amount = custodyWithholdingAmount(withholdingLine);

  companion.ACCOUNTTYPE = 'Vend' as any;
  companion.ACCOUNTDISPLAYVALUE = vendorLine.ACCOUNTDISPLAYVALUE;
  companion.DEBITAMOUNT = amount;
  companion.CREDITAMOUNT = 0;
  companion.IsVendor = true;
  companion.IsLedger = false;
  companion.IsCustodyVendor = false;
  companion.OFFSETACCOUNTTYPE = 'Ledger' as any;
  companion.OFFSETACCOUNTDISPLAYVALUE = withholdingLine.ACCOUNTDISPLAYVALUE;
  companion.OFFSETDEFAULTDIMENSIONDISPLAYVALUE =
    withholdingLine.DEFAULTDIMENSIONDISPLAYVALUE;
  companion.OFFSETFINTAGDISPLAYVALUE = withholdingLine.FINTAGDISPLAYVALUE || '';
  companion.PAYMENTMETHOD =
    withholdingLine.PAYMENTMETHOD || vendorLine.PAYMENTMETHOD;
  companion.PAYMENTREFERENCE =
    withholdingLine.PAYMENTREFERENCE || vendorLine.PAYMENTREFERENCE;
  companion.DESCRIPTION = withholdingLine.DESCRIPTION || vendorLine.DESCRIPTION;
  companion.TEXT = withholdingLine.TEXT || vendorLine.TEXT;
  companion.ITEMWITHHOLDINGTAXGROUPCODE = '';
  companion.ISWITHHOLDINGCALCULATIONENABLED = 'No';

  return companion;
}
