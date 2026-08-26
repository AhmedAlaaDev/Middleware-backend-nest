import {
  allocateCustodySettlementWithholdingLines,
  resolveCustodySettlementMarking,
} from './custody-settlement-marking.policy';

import { CashEntryMarkedLine } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { isCashWithholdingLedgerLine } from '@/modules/cash/policies/cash-withholding.policy';

export interface CustodySettlementLinePlan {
  line: CashEntryRawDataModel;
  isVendorLine: boolean;
  isWithholdingLine: boolean;
  markedInvoice: string;
  markedLines: readonly CashEntryMarkedLine[];
}

function isVendorSourceLine(line: CashEntryRawDataModel): boolean {
  const accountType = String(line.ACCOUNTTYPE ?? '')
    .trim()
    .toLowerCase();
  return (
    Boolean(line.IsVendor) || accountType === 'vend' || accountType === 'vendor'
  );
}

/**
 * Owns Cash-Out Custody Settlement preparation.
 *
 * Custody Settlement keeps its existing business rules:
 * - explicit withholding ledger rows are preserved as journal lines;
 * - the vendor debit remains gross so the preserved lines stay balanced;
 * - MarkedLines only flags withholding matched to that vendor source row;
 * - offsets are cleared;
 * - each source row becomes one output line.
 *
 * It deliberately does not decide the journal family. Routing remains in the
 * shared cash routing service so Cash-Out continues to post through the
 * configured Finance vendor-payment journal.
 */
export function prepareCustodySettlementLines(
  lines: CashEntryRawDataModel[],
): CustodySettlementLinePlan[] {
  const withholdingLines = lines.filter(isCashWithholdingLedgerLine);
  const vendorLines = lines.filter(isVendorSourceLine);
  const withholdingAllocation = allocateCustodySettlementWithholdingLines(
    lines,
    vendorLines,
    withholdingLines,
  );

  return lines.map((rawLine) => {
    const isVendorLine = isVendorSourceLine(rawLine);
    const isWithholdingLine = isCashWithholdingLedgerLine(rawLine);
    const line = Object.assign(
      Object.create(Object.getPrototypeOf(rawLine)),
      rawLine,
    ) as CashEntryRawDataModel;

    const withholdingLine = isVendorLine
      ? withholdingAllocation.withholdingByVendorLine.get(rawLine)
      : undefined;

    line.OFFSETACCOUNTTYPE = '' as any;
    line.OFFSETACCOUNTDISPLAYVALUE = '';
    line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE = '';

    if (isWithholdingLine) {
      const matchedVendorLine =
        withholdingAllocation.invoiceOwnerByWithholdingLine.get(rawLine);
      const marking = matchedVendorLine
        ? resolveCustodySettlementMarking({ vendorLine: matchedVendorLine })
        : undefined;

      return {
        line,
        isVendorLine: false,
        isWithholdingLine: true,
        markedInvoice: marking?.markedInvoice ?? '',
        markedLines: marking?.markedLines ?? [],
      };
    }

    if (!isVendorLine) {
      return {
        line,
        isVendorLine,
        isWithholdingLine: false,
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
      isWithholdingLine: false,
      markedInvoice: marking.markedInvoice,
      markedLines: marking.markedLines,
    };
  });
}
