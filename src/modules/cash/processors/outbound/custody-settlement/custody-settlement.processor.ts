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
 * - withholding ledger rows remain aggregated for the amount calculation;
 * - withholding is deducted from the vendor debit;
 * - MarkedLines only flags withholding matched to that vendor source row;
 * - offsets are cleared;
 * - each non-withholding source row becomes one output line.
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
  const totalWithholdingAmount = withholdingLines.reduce(
    (sum, line) => sum + Number(line.CREDITAMOUNT || line.DEBITAMOUNT || 0),
    0,
  );

  return nonWithholdingLines.map((rawLine) => {
    const accountType = String(rawLine.ACCOUNTTYPE ?? '')
      .trim()
      .toLowerCase();
    const isVendorLine =
      Boolean(rawLine.IsVendor) ||
      accountType === 'vend' ||
      accountType === 'vendor';
    const line = Object.assign(
      Object.create(Object.getPrototypeOf(rawLine)),
      rawLine,
    ) as CashEntryRawDataModel;

    const withholdingLine = isVendorLine
      ? findCustodySettlementWithholdingLine(line, withholdingLines)
      : undefined;

    if (isVendorLine && Number(line.DEBITAMOUNT || 0) > 0) {
      line.DEBITAMOUNT = Math.max(
        0,
        Number(line.DEBITAMOUNT || 0) - totalWithholdingAmount,
      );
    }

    line.OFFSETACCOUNTTYPE = '' as any;
    line.OFFSETACCOUNTDISPLAYVALUE = '';
    line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE = '';

    if (!isVendorLine) {
      return {
        line,
        isVendorLine,
        markedInvoice: '',
        markedLines: [],
      };
    }

    const marking = resolveCustodySettlementMarking({
      vendorLine: line,
      withholdingLine,
    });

    return {
      line,
      isVendorLine,
      markedInvoice: marking.markedInvoice,
      markedLines: marking.markedLines,
    };
  });
}
