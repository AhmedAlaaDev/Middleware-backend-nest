import { VendorPaymentClassification } from './policies/vendor-payment-line.policy';

export interface VendorPaymentStructuralError {
  field: string;
  message: string;
}

/**
 * Validates Vendor Payment structural invariants that require no external data.
 * Runs AFTER classification, BEFORE lookup.
 */
export function validateVendorPaymentStructure(
  classification: VendorPaymentClassification,
  sourceId: string,
): VendorPaymentStructuralError[] {
  const errors: VendorPaymentStructuralError[] = [];

  if (classification.vendorDebitLines.length === 0) {
    errors.push({
      field: 'VendorLines',
      message: `UniqueId ${sourceId}: Vendor Payment requires one or more debit Vendor lines. Found 0.`,
    });
  }

  if (!classification.paymentOffset) {
    errors.push({
      field: 'PaymentOffset',
      message: `UniqueId ${sourceId}: Vendor Payment requires exactly one credit payment offset.`,
    });
  }

  if (classification.invalidDebitLines.length > 0) {
    errors.push({
      field: 'InvalidDebitLines',
      message: `UniqueId ${sourceId}: Vendor Payment contains ${classification.invalidDebitLines.length} non-Vendor debit line(s).`,
    });
  }

  for (const vendorLine of classification.vendorDebitLines) {
    const account = String(vendorLine.ACCOUNTDISPLAYVALUE ?? '').trim();
    if (!account) {
      errors.push({
        field: 'VendorAccount',
        message: `Line ${vendorLine.LINENUMBER}: Vendor account is required.`,
      });
    }
  }

  return errors;
}
