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
  markedInvoice: string;
  markedLines: readonly CashEntryMarkedLine[];
}

/**
 * Owns Cash-Out Custody Settlement preparation.
 *
 * Every source row is posted; none is dropped or merged away. In particular,
 * Collect 223404 debit / 512301 credit rows remain in the same source voucher
 * because the voucher may only close after the full source sequence is kept:
 * - a 223304 row matched to a vendor debit becomes a Vendor -> 223304 line,
 *   the same shape Vendor Payment posts, so Finance shows the vendor account
 *   with withholding as its offset instead of a bare ledger line. That vendor
 *   debit is reduced by the withholding, so the two lines together still
 *   settle the gross invoice amount;
 * - a 223304 row with no matching vendor debit stays its own ledger line;
 * - all other vendor debit/credit amounts stay exactly as the source;
 * - MarkedLines still flags withholding that belongs to that vendor row;
 * - offsets are cleared on the main custody rows.
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
  const vendorDebitLines = nonWithholdingLines.filter((rawLine) => {
    const accountType = String(rawLine.ACCOUNTTYPE ?? '')
      .trim()
      .toLowerCase();
    const isVendorLine =
      Boolean(rawLine.IsVendor) ||
      accountType === 'vend' ||
      accountType === 'vendor';
    return isVendorLine && Number(rawLine.DEBITAMOUNT || 0) > 0;
  });
  const withholdingByVendor = allocateCustodySettlementWithholdingLines(
    vendorDebitLines,
    withholdingLines,
    lines,
  );
  const plans: CustodySettlementLinePlan[] = [];
  const withholdingPostedAsOffset = new Set<CashEntryRawDataModel>();

  for (const rawLine of nonWithholdingLines) {
    const accountType = String(rawLine.ACCOUNTTYPE ?? '')
      .trim()
      .toLowerCase();
    const isVendorLine =
      Boolean(rawLine.IsVendor) ||
      accountType === 'vend' ||
      accountType === 'vendor';
    const line = cloneCashSettlementLine(rawLine);
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

    const withholdingLine =
      Number(line.DEBITAMOUNT || 0) > 0
        ? withholdingByVendor.get(rawLine)
        : undefined;
    const marking = resolveCustodySettlementMarking({
      vendorLine: line,
      withholdingLine,
    });

    const companion = withholdingLine
      ? buildCustodyWithholdingCompanion(line, withholdingLine)
      : undefined;
    if (companion && withholdingLine) {
      // Vendor Payment marks the companion before the main line inside the
      // same X++ settlement transaction. Keep that order here too.
      plans.push({
        line: companion,
        isVendorLine: true,
        markedInvoice: marking.markedInvoice,
        markedLines: marking.markedLines,
      });
      line.DEBITAMOUNT = subtractCustodyAmount(
        Number(line.DEBITAMOUNT || 0),
        custodyWithholdingAmount(withholdingLine),
      );
      withholdingPostedAsOffset.add(withholdingLine);
    }

    plans.push({
      line,
      isVendorLine,
      markedInvoice: marking.markedInvoice,
      markedLines: marking.markedLines,
    });
  }

  for (const withholdingLine of withholdingLines) {
    if (withholdingPostedAsOffset.has(withholdingLine)) continue;
    const line = cloneCashSettlementLine(withholdingLine);
    clearCustodySettlementOffset(line);
    if (!String(line.INVOICE ?? '').trim()) {
      const owner = [...withholdingByVendor.entries()].find(
        ([, allocated]) => allocated === withholdingLine,
      )?.[0];
      if (owner) {
        line.INVOICE = String(owner.INVOICE ?? owner.MARKEDINVOICE ?? '').trim();
      }
    }
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
  const credit = Math.abs(Number(line.CREDITAMOUNT ?? 0));
  const debit = Math.abs(Number(line.DEBITAMOUNT ?? 0));
  return credit > 0 ? credit : debit;
}

/**
 * Subtracts without changing the precision of the source amount. Excel cash
 * rows carry more than two decimals, so currency-decimal rounding would move
 * money; this only removes binary floating-point noise.
 */
function subtractCustodyAmount(amount: number, subtrahend: number): number {
  return Number((amount - subtrahend).toFixed(6));
}

/**
 * Turns one 223304 source row into the vendor line that carries it as an
 * offset. The vendor identity, invoice and dimensions come from the settled
 * vendor row; only the amount and the offset account come from the 223304 row.
 * Returns undefined when the withholding cannot fit inside the vendor debit,
 * so the caller keeps posting that row as its own ledger line.
 */
function buildCustodyWithholdingCompanion(
  vendorLine: CashEntryRawDataModel,
  withholdingLine: CashEntryRawDataModel,
): CashEntryRawDataModel | undefined {
  const amount = custodyWithholdingAmount(withholdingLine);
  if (amount <= 0 || amount > Number(vendorLine.DEBITAMOUNT || 0)) {
    return undefined;
  }

  const companion = cloneCashSettlementLine(vendorLine);
  // Keep the source row identity of the withholding line for traceability.
  companion.LINENUMBER = withholdingLine.LINENUMBER;
  companion.DEBITAMOUNT = amount;
  companion.CREDITAMOUNT = 0;
  companion.OFFSETACCOUNTTYPE = 'Ledger' as any;
  companion.OFFSETACCOUNTDISPLAYVALUE = String(
    withholdingLine.ACCOUNTDISPLAYVALUE ?? '',
  );
  companion.OFFSETDEFAULTDIMENSIONDISPLAYVALUE = '';
  companion.OFFSETFINTAGDISPLAYVALUE = String(
    withholdingLine.FINTAGDISPLAYVALUE ?? '',
  );
  companion.OFFSETTEXT = String(
    withholdingLine.TEXT ?? vendorLine.TEXT ?? '',
  );
  return companion;
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
