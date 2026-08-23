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

/**
 * Finds the withholding source row belonging to one Custody Settlement vendor
 * row. The precedence intentionally matches Vendor Payment, while keeping the
 * Custody Settlement rule independent from the Vendor Payment feature.
 */
export function findCustodySettlementWithholdingLine(
  vendorLine: CashEntryRawDataModel,
  withholdingLines: readonly CashEntryRawDataModel[],
): CashEntryRawDataModel | undefined {
  if (withholdingLines.length === 0) return undefined;

  const uniqueId = String(vendorLine.UniqueId ?? '').trim();
  if (uniqueId) {
    const match = withholdingLines.find(
      (line) => String(line.UniqueId ?? '').trim() === uniqueId,
    );
    if (match) return match;
  }

  const voucher = String(vendorLine.VOUCHER ?? '').trim();
  if (voucher) {
    const match = withholdingLines.find(
      (line) => String(line.VOUCHER ?? '').trim() === voucher,
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
