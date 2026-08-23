import { CashEntryDynDataModel } from '@/modules/cash/models/cash-entry-dyn-data.model';

export interface CustodySettlementValidationError {
  field: string;
  message: string;
}

/**
 * Enforces only the request shape required when Custody Settlement explicitly
 * asks D365 to mark an invoice. An unmarked vendor line is valid and must be
 * allowed through so D365 can persist the financial line without settlement.
 */
export function validateCustodySettlementVendorInvoiceShape(
  line: CashEntryDynDataModel,
): CustodySettlementValidationError[] {
  if (
    line.SafeType !== 'Custody Settlement' ||
    line.SettlementTargetType !== 'VendorInvoice'
  ) {
    return [];
  }

  const errors: CustodySettlementValidationError[] = [];
  const markedLines = Array.isArray(line.MarkedLines) ? line.MarkedLines : [];

  if (line.SettlementIntent !== 'Marked' && markedLines.length === 0) {
    return errors;
  }

  if (!String(line.AccountDisplayValue ?? '').trim()) {
    errors.push({
      field: 'AccountDisplayValue',
      message: 'Custody Settlement vendor account is required.',
    });
  }
  if (line.SettlementIntent !== 'Marked' || markedLines.length === 0) {
    errors.push({
      field: 'MarkedInvoice',
      message:
        'Custody Settlement marked settlement intent must include MarkedLines.',
    });
    return errors;
  }

  markedLines.forEach((markedLine, index) => {
    if (!String(markedLine.InvoiceNumber ?? '').trim()) {
      errors.push({
        field: 'MarkedInvoice',
        message: `Custody Settlement MarkedLines[${index}] invoice number is required.`,
      });
    }
    if (!String(markedLine.DocumentNumber ?? '').trim()) {
      errors.push({
        field: 'DocumentNumber',
        message: `Custody Settlement MarkedLines[${index}] document number is required.`,
      });
    }
  });

  return errors;
}
