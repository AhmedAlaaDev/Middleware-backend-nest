import { VendorPaymentSettlementIntent } from '../models/vendor-payment-marking-result';
import { VendorPaymentDescriptionPolicy } from './vendor-payment-description.policy';

describe('VendorPaymentDescriptionPolicy', () => {
  const policy = new VendorPaymentDescriptionPolicy();

  it('uses the Finance business description for a marked payment', () => {
    expect(
      policy.getDescription({
        settlementState: VendorPaymentSettlementIntent.MARKED,
        target: 'Freight',
        monthYear: 'May 2026',
        voucherType: 'cash',
        invoiceNumber: ' INV-100 ',
      }),
    ).toBe('Vendor Payment - Freight May 2026 (Cash)');
  });

  it('keeps the invoice beside an intentionally unmarked payment', () => {
    expect(
      policy.getDescription({
        settlementState: VendorPaymentSettlementIntent.UNMARKED,
        target: 'Freight',
        monthYear: 'May 2026',
        voucherType: 'bank transfer',
        invoiceNumber: 'INV-100',
      }),
    ).toBe('Vendor Payment - Freight May 2026 (Transfer) - Unmarked - INV-100');
  });

  it('uses Unmarked when an intentionally unmarked payment has no invoice', () => {
    expect(
      policy.getDescription({
        settlementState: VendorPaymentSettlementIntent.UNMARKED,
        target: 'Fleet',
        monthYear: 'May 2026',
        voucherType: 'check',
      }),
    ).toBe('Vendor Payment - Fleet May 2026 (Cheque) - Unmarked');
  });
});
