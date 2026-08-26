import { CashEntryMarkedLine } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  resolveCashOutboundInvoice,
  sanitizeCashOutboundInvoice,
} from '@/modules/cash/policies/cash-account.policy';
import { firstCashFinancialTag } from '@/modules/cash/policies/cash-invoice.policy';

export interface CustodySettlementMarkingResult {
  readonly shouldMark: boolean;
  readonly markedInvoice: string;
  readonly markedLines: readonly CashEntryMarkedLine[];
  readonly reason: string;
}

export interface CustodySettlementWithholdingAllocation {
  readonly withholdingByVendorLine: ReadonlyMap<
    CashEntryRawDataModel,
    CashEntryRawDataModel
  >;
  readonly invoiceOwnerByWithholdingLine: ReadonlyMap<
    CashEntryRawDataModel,
    CashEntryRawDataModel
  >;
}

function cashLineAmount(line: CashEntryRawDataModel): number {
  return Math.max(
    Math.abs(Number(line.DEBITAMOUNT ?? 0)),
    Math.abs(Number(line.CREDITAMOUNT ?? 0)),
  );
}

function custodyWithholdingCandidatePool(
  withholdingLine: CashEntryRawDataModel,
  vendorLines: readonly CashEntryRawDataModel[],
): CashEntryRawDataModel[] {
  const voucher = String(withholdingLine.VOUCHER ?? '').trim();
  if (voucher) {
    const voucherMatches = vendorLines.filter(
      (line) => String(line.VOUCHER ?? '').trim() === voucher,
    );
    if (voucherMatches.length > 0) return voucherMatches;
  }

  const invoice = sanitizeCashOutboundInvoice(withholdingLine.INVOICE);
  if (invoice) {
    const invoiceMatches = vendorLines.filter(
      (line) => sanitizeCashOutboundInvoice(line.INVOICE) === invoice,
    );
    if (invoiceMatches.length > 0) return invoiceMatches;
  }

  const uniqueId = String(withholdingLine.UniqueId ?? '').trim();
  if (uniqueId) {
    const uniqueIdMatches = vendorLines.filter(
      (line) => String(line.UniqueId ?? '').trim() === uniqueId,
    );
    if (uniqueIdMatches.length > 0) return uniqueIdMatches;
  }

  const documentNumber = String(withholdingLine.DOCUMENT ?? '').trim();
  const currencyCode = String(withholdingLine.CURRENCYCODE ?? '').trim();
  const operationNumber = firstCashFinancialTag(
    withholdingLine.FINTAGDISPLAYVALUE,
  );

  return vendorLines.filter(
    (line) =>
      String(line.DOCUMENT ?? '').trim() === documentNumber &&
      String(line.CURRENCYCODE ?? '').trim() === currencyCode &&
      firstCashFinancialTag(line.FINTAGDISPLAYVALUE) === operationNumber,
  );
}

/**
 * Allocates every explicit 223304 row once to its structural settlement pair.
 *
 * Custody exports can reuse one UniqueId for several vouchers and invoices.
 * Within a withholding voucher the owning supplier debit follows the 223304
 * row, while the matching custody credit precedes it. Selecting those nearest
 * rows prevents one withholding line from being copied to every row in the
 * wider payment group.
 */
export function allocateCustodySettlementWithholdingLines(
  lines: readonly CashEntryRawDataModel[],
  vendorLines: readonly CashEntryRawDataModel[],
  withholdingLines: readonly CashEntryRawDataModel[],
): CustodySettlementWithholdingAllocation {
  const withholdingByVendorLine = new Map<
    CashEntryRawDataModel,
    CashEntryRawDataModel
  >();
  const invoiceOwnerByWithholdingLine = new Map<
    CashEntryRawDataModel,
    CashEntryRawDataModel
  >();
  const claimedVendorLines = new Set<CashEntryRawDataModel>();
  const positions = new Map(lines.map((line, index) => [line, index] as const));

  for (const withholdingLine of withholdingLines) {
    const withholdingPosition = positions.get(withholdingLine) ?? -1;
    const candidates = custodyWithholdingCandidatePool(
      withholdingLine,
      vendorLines.filter((line) => !claimedVendorLines.has(line)),
    );
    const debitCandidates = candidates.filter(
      (line) => Number(line.DEBITAMOUNT ?? 0) > 0,
    );
    const followingDebits = debitCandidates
      .filter((line) => (positions.get(line) ?? -1) > withholdingPosition)
      .sort(
        (left, right) =>
          (positions.get(left) ?? 0) - (positions.get(right) ?? 0),
      );
    const invoiceOwner =
      followingDebits[0] ??
      debitCandidates.sort(
        (left, right) =>
          Math.abs((positions.get(left) ?? 0) - withholdingPosition) -
          Math.abs((positions.get(right) ?? 0) - withholdingPosition),
      )[0];

    if (!invoiceOwner) continue;

    withholdingByVendorLine.set(invoiceOwner, withholdingLine);
    invoiceOwnerByWithholdingLine.set(withholdingLine, invoiceOwner);
    claimedVendorLines.add(invoiceOwner);

    const ownerInvoice = sanitizeCashOutboundInvoice(invoiceOwner.INVOICE);
    const creditCandidates = candidates
      .filter(
        (line) =>
          !claimedVendorLines.has(line) &&
          Number(line.CREDITAMOUNT ?? 0) > 0 &&
          (!ownerInvoice ||
            sanitizeCashOutboundInvoice(line.INVOICE) === ownerInvoice),
      )
      .sort((left, right) => {
        const leftPosition = positions.get(left) ?? -1;
        const rightPosition = positions.get(right) ?? -1;
        const leftPrecedes = leftPosition < withholdingPosition ? 0 : 1;
        const rightPrecedes = rightPosition < withholdingPosition ? 0 : 1;
        if (leftPrecedes !== rightPrecedes) return leftPrecedes - rightPrecedes;
        return (
          Math.abs(leftPosition - withholdingPosition) -
          Math.abs(rightPosition - withholdingPosition)
        );
      });
    const custodyOwner = creditCandidates[0];
    if (!custodyOwner) continue;

    const balanceDifference = Math.abs(
      cashLineAmount(invoiceOwner) -
        cashLineAmount(custodyOwner) -
        cashLineAmount(withholdingLine),
    );
    if (balanceDifference > 0.01) continue;

    withholdingByVendorLine.set(custodyOwner, withholdingLine);
    claimedVendorLines.add(custodyOwner);
  }

  return Object.freeze({
    withholdingByVendorLine,
    invoiceOwnerByWithholdingLine,
  });
}

/**
 * Finds the withholding source row belonging to one Custody Settlement vendor
 * row. Voucher identity wins over the wider UniqueId because one custody
 * payment group can contain several vouchers and invoices.
 */
export function findCustodySettlementWithholdingLine(
  vendorLine: CashEntryRawDataModel,
  withholdingLines: readonly CashEntryRawDataModel[],
): CashEntryRawDataModel | undefined {
  if (withholdingLines.length === 0) return undefined;

  const voucher = String(vendorLine.VOUCHER ?? '').trim();
  if (voucher) {
    const match = withholdingLines.find(
      (line) => String(line.VOUCHER ?? '').trim() === voucher,
    );
    if (match) return match;
  }

  const uniqueId = String(vendorLine.UniqueId ?? '').trim();
  if (uniqueId) {
    const match = withholdingLines.find(
      (line) => String(line.UniqueId ?? '').trim() === uniqueId,
    );
    if (match) return match;
  }

  const invoice = sanitizeCashOutboundInvoice(vendorLine.INVOICE);
  if (invoice) {
    const match = withholdingLines.find(
      (line) => sanitizeCashOutboundInvoice(line.INVOICE) === invoice,
    );
    if (match) return match;
  }

  const documentNumber = String(vendorLine.DOCUMENT ?? '').trim();
  const operationNumber = firstCashFinancialTag(vendorLine.FINTAGDISPLAYVALUE);

  return withholdingLines.find(
    (line) =>
      String(line.DOCUMENT ?? '').trim() === documentNumber &&
      String(line.CURRENCYCODE ?? '').trim() ===
        String(vendorLine.CURRENCYCODE ?? '').trim() &&
      firstCashFinancialTag(line.FINTAGDISPLAYVALUE) === operationNumber,
  );
}

/**
 * Produces the complete, atomic Custody Settlement marking decision.
 * MarkedLines is only created when both the invoice and document are present.
 * OperationNumber is the cleaned first segment of FINTAGDISPLAYVALUE.
 */
export function resolveCustodySettlementMarking(options: {
  vendorLine: CashEntryRawDataModel;
  withholdingLine?: CashEntryRawDataModel;
}): CustodySettlementMarkingResult {
  const { vendorLine, withholdingLine } = options;
  const markedInvoice = resolveCashOutboundInvoice(
    vendorLine.MARKEDINVOICE,
    vendorLine.INVOICE,
  );
  const documentNumber = String(vendorLine.DOCUMENT ?? '').trim();

  if (!markedInvoice || !documentNumber) {
    return Object.freeze({
      shouldMark: false,
      markedInvoice: '',
      markedLines: Object.freeze([]),
      reason: !markedInvoice
        ? 'invoice number is missing'
        : 'document number is missing',
    });
  }

  const markedLine: CashEntryMarkedLine = Object.freeze({
    InvoiceNumber: markedInvoice,
    OperationNumber: firstCashFinancialTag(vendorLine.FINTAGDISPLAYVALUE),
    DocumentNumber: documentNumber,
    HasWithHoldingLine: Boolean(withholdingLine),
  });

  return Object.freeze({
    shouldMark: true,
    markedInvoice,
    markedLines: Object.freeze([markedLine]),
    reason: withholdingLine
      ? 'vendor invoice with matched withholding line'
      : 'vendor invoice without withholding line',
  });
}
