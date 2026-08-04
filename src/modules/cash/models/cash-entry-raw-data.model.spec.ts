import { CashEntryRawDataModel } from './cash-entry-raw-data.model';

describe('CashEntryRawDataModel account-type flags', () => {
  it.each(['Vend', 'vend', 'Vendor', 'VENDOR'])(
    'treats ACCOUNTTYPE %s as a vendor',
    (accountType) => {
      const line = new CashEntryRawDataModel(
        {
          ACCOUNTTYPE: accountType,
          DEBITAMOUNT: 100,
          CREDITAMOUNT: 0,
          SafeType: 'Vendor Payment',
        } as any,
        'Freight',
        false,
      );

      expect(line.IsVendor).toBe(true);
      expect(line.IsVendorPayment).toBe(true);
    },
  );

  it('does not treat Ledger as a vendor', () => {
    const line = new CashEntryRawDataModel(
      {
        ACCOUNTTYPE: 'Ledger',
        SafeType: 'Vendor Payment',
      } as any,
      'Freight',
      false,
    );

    expect(line.IsVendor).toBe(false);
  });
});
