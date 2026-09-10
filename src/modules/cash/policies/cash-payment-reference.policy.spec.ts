import {
  CASH_PAYMENT_REFERENCE_MAX_LENGTH,
  cashPaymentReferenceLengthErrorMessage,
  isCashPaymentReferenceTooLong,
} from './cash-payment-reference.policy';

describe('cash payment reference length', () => {
  const exactly35 = 'A'.repeat(CASH_PAYMENT_REFERENCE_MAX_LENGTH);
  const over35 = `${exactly35}X`;

  it('allows empty, short, and exactly 35-character values', () => {
    expect(isCashPaymentReferenceTooLong('')).toBe(false);
    expect(isCashPaymentReferenceTooLong('FT26060B54Z5')).toBe(false);
    expect(isCashPaymentReferenceTooLong(exactly35)).toBe(false);
    expect(cashPaymentReferenceLengthErrorMessage({ paymentReference: exactly35 })).toBeUndefined();
  });

  it('rejects values longer than 35 characters', () => {
    expect(isCashPaymentReferenceTooLong(over35)).toBe(true);
    expect(
      cashPaymentReferenceLengthErrorMessage({
        paymentReference: over35,
        lineNumber: 12,
        uniqueId: 486660,
      }),
    ).toBe(
      `Line 12 (UniqueId 486660): PAYMENTREFERENCE exceeds ${CASH_PAYMENT_REFERENCE_MAX_LENGTH} characters (36).`,
    );
  });
});
