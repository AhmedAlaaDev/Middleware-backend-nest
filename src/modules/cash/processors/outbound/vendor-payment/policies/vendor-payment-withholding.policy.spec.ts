import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { findVendorPaymentWithholdingLine } from './vendor-payment-withholding.policy';

const line = (values: Partial<CashEntryRawDataModel>): CashEntryRawDataModel =>
  values as CashEntryRawDataModel;

describe('findVendorPaymentWithholdingLine', () => {
  it('matches by invoice before a shared UniqueId', () => {
    const withholdingForA = line({ UniqueId: 100, INVOICE: 'INV-A' });
    const withholdingForB = line({ UniqueId: 100, INVOICE: 'INV-B' });

    expect(
      findVendorPaymentWithholdingLine(
        line({ UniqueId: 100, INVOICE: 'INV-B' }),
        [withholdingForA, withholdingForB],
      ),
    ).toBe(withholdingForB);
  });

  it('uses UniqueId only when no invoice-specific row exists', () => {
    const fallback = line({ UniqueId: 100, INVOICE: '' });

    expect(
      findVendorPaymentWithholdingLine(
        line({ UniqueId: 100, INVOICE: 'INV-A' }),
        [fallback],
      ),
    ).toBe(fallback);
  });
});
