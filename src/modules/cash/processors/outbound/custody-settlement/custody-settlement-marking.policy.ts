import { CashEntryMarkedLine } from '@/modules/cash/models/cash-entry-dyn-data.model';
import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  resolveCashOutboundInvoice,
  sanitizeCashOutboundInvoice,
} from '@/modules/cash/policies/cash-account.policy';
import { firstCashFinancialTag } from '@/modules/cash/policies/cash-invoice.policy';
import { isCashWithholdingLedgerLine } from '@/modules/cash/policies/cash-withholding.policy';

const CUSTODY_WHT_AMOUNT_TOLERANCE = 0.01;

export interface CustodySettlementMarkingResult {
  readonly shouldMark: boolean;
  readonly markedInvoice: string;
  readonly markedLines: readonly CashEntryMarkedLine[];
  readonly reason: string;
}

function custodyInvoice(line: CashEntryRawDataModel): string {
  return sanitizeCashOutboundInvoice(
    resolveCashOutboundInvoice(line.MARKEDINVOICE, line.INVOICE),
  );
}

function withholdingAmount(line: CashEntryRawDataModel): number {
  const credit = Math.abs(Number(line.CREDITAMOUNT ?? 0));
  const debit = Math.abs(Number(line.DEBITAMOUNT ?? 0));
  return credit > 0 ? credit : debit;
}

function moneyClose(left: number, right: number): boolean {
  return Math.abs(left - right) <= CUSTODY_WHT_AMOUNT_TOLERANCE;
}

function isCustodyCreditLine(line: CashEntryRawDataModel): boolean {
  return (
    !isCashWithholdingLedgerLine(line) && Number(line.CREDITAMOUNT ?? 0) > 0
  );
}

/**
 * Finds the withholding source row belonging to one Custody Settlement vendor
 * row. Invoice wins before UniqueId: a UniqueId in the WHT export can contain
 * several invoices, and UniqueId-first matching mixed their 223304 lines.
 * UniqueId/voucher are last-resort only when the withholding row has no invoice.
 */
export function findCustodySettlementWithholdingLine(
  vendorLine: CashEntryRawDataModel,
  withholdingLines: readonly CashEntryRawDataModel[],
): CashEntryRawDataModel | undefined {
  if (withholdingLines.length === 0) return undefined;

  const invoice = custodyInvoice(vendorLine);
  if (invoice) {
    const invoiceMatches = withholdingLines.filter(
      (line) => custodyInvoice(line) === invoice,
    );
    const operation = firstCashFinancialTag(vendorLine.FINTAGDISPLAYVALUE);
    const exactOperationMatch = operation
      ? invoiceMatches.find(
          (line) =>
            firstCashFinancialTag(line.FINTAGDISPLAYVALUE) === operation,
        )
      : undefined;
    if (exactOperationMatch) return exactOperationMatch;
    if (invoiceMatches.length > 0) return invoiceMatches[0];
  }

  const documentNumber = String(vendorLine.DOCUMENT ?? '').trim();
  const operationNumber = firstCashFinancialTag(vendorLine.FINTAGDISPLAYVALUE);
  const operationMatch = withholdingLines.find(
    (line) =>
      !custodyInvoice(line) &&
      String(line.DOCUMENT ?? '').trim() === documentNumber &&
      String(line.CURRENCYCODE ?? '').trim() ===
        String(vendorLine.CURRENCYCODE ?? '').trim() &&
      firstCashFinancialTag(line.FINTAGDISPLAYVALUE) === operationNumber,
  );
  if (operationMatch) return operationMatch;

  const uniqueId = String(vendorLine.UniqueId ?? '').trim();
  if (uniqueId) {
    const match = withholdingLines.find(
      (line) =>
        !custodyInvoice(line) &&
        String(line.UniqueId ?? '').trim() === uniqueId,
    );
    if (match) return match;
  }

  const voucher = String(vendorLine.VOUCHER ?? '').trim();
  if (voucher) {
    return withholdingLines.find(
      (line) =>
        !custodyInvoice(line) &&
        String(line.VOUCHER ?? '').trim() === voucher,
    );
  }

  return undefined;
}

/**
 * Allocates each 223304 row once. Prefer the vendor debit whose amount is
 * custody credit + withholding for that invoice, so a small companion debit
 * on the same invoice does not steal the WHT flag.
 */
export function allocateCustodySettlementWithholdingLines(
  vendorDebitLines: readonly CashEntryRawDataModel[],
  withholdingLines: readonly CashEntryRawDataModel[],
  groupLines: readonly CashEntryRawDataModel[],
): Map<CashEntryRawDataModel, CashEntryRawDataModel> {
  const allocation = new Map<CashEntryRawDataModel, CashEntryRawDataModel>();
  const claimed = new Set<CashEntryRawDataModel>();
  const credits = groupLines.filter(isCustodyCreditLine);

  const amountCompatible = (
    vendorLine: CashEntryRawDataModel,
    withholdingLine: CashEntryRawDataModel,
  ): boolean => {
    const invoice = custodyInvoice(vendorLine);
    const debit = Number(vendorLine.DEBITAMOUNT ?? 0);
    const expectedCredit = debit - withholdingAmount(withholdingLine);
    return credits.some(
      (credit) =>
        (!invoice || custodyInvoice(credit) === invoice) &&
        moneyClose(Number(credit.CREDITAMOUNT ?? 0), expectedCredit),
    );
  };

  for (const withholdingLine of withholdingLines) {
    const invoice = custodyInvoice(withholdingLine);
    const pool = vendorDebitLines.filter((vendorLine) => {
      if (allocation.has(vendorLine)) return false;
      if (invoice && custodyInvoice(vendorLine) !== invoice) return false;
      return true;
    });
    const compatible = pool.filter((vendorLine) =>
      amountCompatible(vendorLine, withholdingLine),
    );
    const chosen = compatible[0] ?? (pool.length === 1 ? pool[0] : undefined);
    if (!chosen) continue;
    allocation.set(chosen, withholdingLine);
    claimed.add(withholdingLine);
  }

  for (const vendorLine of vendorDebitLines) {
    if (allocation.has(vendorLine)) continue;
    const match = findCustodySettlementWithholdingLine(
      vendorLine,
      withholdingLines.filter((line) => !claimed.has(line)),
    );
    if (!match) continue;
    allocation.set(vendorLine, match);
    claimed.add(match);
  }

  return allocation;
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
