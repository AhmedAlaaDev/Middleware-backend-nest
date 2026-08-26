import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  allocateVendorPaymentWithholdingLines,
  findVendorPaymentWithholdingLine,
} from './vendor-payment-withholding.policy';

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

  it('uses operation to select the correct withholding row when an invoice repeats', () => {
    const first = line({
      INVOICE: '3939',
      FINTAGDISPLAYVALUE: 'O25-IMP-AI-12501|first',
    });
    const exact = line({
      INVOICE: '3939',
      FINTAGDISPLAYVALUE: 'O25-IMP-AI-12510|exact',
    });

    expect(
      findVendorPaymentWithholdingLine(
        line({
          INVOICE: '3939',
          FINTAGDISPLAYVALUE: 'O25-IMP-AI-12510|vendor',
        }),
        [first, exact],
      ),
    ).toBe(exact);
  });

  it('reserves an exact repeated-invoice operation before applying invoice fallback', () => {
    const earlierVendor = line({
      INVOICE: '3939',
      FINTAGDISPLAYVALUE: 'O25-IMP-AI-12501|earlier',
    });
    const exactVendor = line({
      INVOICE: '3939',
      FINTAGDISPLAYVALUE: 'O25-IMP-AI-12510|exact',
    });
    const withholding = line({
      INVOICE: '3939',
      FINTAGDISPLAYVALUE: 'O25-IMP-AI-12510|withholding',
    });

    const allocation = allocateVendorPaymentWithholdingLines(
      [earlierVendor, exactVendor],
      [withholding],
    );

    expect(allocation.get(earlierVendor)).toBeUndefined();
    expect(allocation.get(exactVendor)).toBe(withholding);
  });
});
