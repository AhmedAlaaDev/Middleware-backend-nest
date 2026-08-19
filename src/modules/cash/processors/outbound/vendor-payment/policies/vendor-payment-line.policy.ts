import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { isCashWithholdingLedgerLine } from '@/modules/cash/policies/cash-withholding.policy';

/**
 * Classifies lines within a Vendor Payment group into their roles.
 * Runs FIRST, before any validation or lookup.
 */
export interface VendorPaymentClassification {
  vendorDebitLines: CashEntryRawDataModel[];
  paymentOffset: CashEntryRawDataModel | undefined;
  withholdingLines: CashEntryRawDataModel[];
  invalidDebitLines: CashEntryRawDataModel[];
}

export function classifyVendorPaymentLines(
  lines: CashEntryRawDataModel[],
): VendorPaymentClassification {
  const withholdingLines: CashEntryRawDataModel[] = [];
  const vendorDebitLines: CashEntryRawDataModel[] = [];
  const creditLines: CashEntryRawDataModel[] = [];
  const invalidDebitLines: CashEntryRawDataModel[] = [];

  for (const line of lines) {
    if (isCashWithholdingLedgerLine(line)) {
      withholdingLines.push(line);
      continue;
    }

    const debit = Number(line.DEBITAMOUNT ?? 0);
    const credit = Number(line.CREDITAMOUNT ?? 0);

    if (debit > 0 && line.IsVendor) {
      vendorDebitLines.push(line);
    } else if (debit > 0 && !line.IsVendor) {
      invalidDebitLines.push(line);
    } else if (credit > 0) {
      creditLines.push(line);
    }
  }

  // Payment offset is the single non-withholding credit line
  const paymentOffset = creditLines.length === 1 ? creditLines[0] : undefined;

  return {
    vendorDebitLines,
    paymentOffset,
    withholdingLines,
    invalidDebitLines,
  };
}
