/** D365FO PaymReference EDT length. Excel values longer than this cannot post. */
export const CASH_PAYMENT_REFERENCE_MAX_LENGTH = 35;

export function cashPaymentReferenceLength(value: unknown): number {
  return String(value ?? '').length;
}

export function isCashPaymentReferenceTooLong(value: unknown): boolean {
  return cashPaymentReferenceLength(value) > CASH_PAYMENT_REFERENCE_MAX_LENGTH;
}

export function cashPaymentReferenceLengthErrorMessage(options: {
  paymentReference: unknown;
  lineNumber?: unknown;
  uniqueId?: unknown;
}): string | undefined {
  if (!isCashPaymentReferenceTooLong(options.paymentReference)) {
    return undefined;
  }

  const length = cashPaymentReferenceLength(options.paymentReference);
  return (
    `Line ${options.lineNumber || '?'} (UniqueId ${options.uniqueId || '?'}): ` +
    `PAYMENTREFERENCE exceeds ${CASH_PAYMENT_REFERENCE_MAX_LENGTH} characters (${length}).`
  );
}
