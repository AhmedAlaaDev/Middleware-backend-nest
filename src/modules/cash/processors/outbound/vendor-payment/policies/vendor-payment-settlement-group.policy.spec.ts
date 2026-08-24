import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';

import { groupVendorPaymentSettlementsByInvoice } from './vendor-payment-settlement-group.policy';

const line = (values: Partial<CashEntryRawDataModel>): CashEntryRawDataModel =>
  values as CashEntryRawDataModel;

describe('groupVendorPaymentSettlementsByInvoice', () => {
  it('aggregates the same D365 invoice even when source operation numbers differ', () => {
    const groups = groupVendorPaymentSettlementsByInvoice([
      {
        vendorLine: line({
          ACCOUNTDISPLAYVALUE: 'Su-000068',
          DOCUMENT: '15902',
          INVOICE: '3939',
          CURRENCYCODE: 'EGP',
          FINTAGDISPLAYVALUE: 'O25-IMP-AI-12501|first',
        }),
      },
      {
        vendorLine: line({
          ACCOUNTDISPLAYVALUE: 'Su-000068',
          DOCUMENT: '15902',
          INVOICE: '3939',
          CURRENCYCODE: 'EGP',
          FINTAGDISPLAYVALUE: 'O25-IMP-AI-12510|second',
        }),
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('still aggregates repeated rows for the same invoice and operation', () => {
    const groups = groupVendorPaymentSettlementsByInvoice([
      {
        vendorLine: line({
          ACCOUNTDISPLAYVALUE: 'Su-000068',
          DOCUMENT: '15902',
          INVOICE: '3939',
          CURRENCYCODE: 'EGP',
          FINTAGDISPLAYVALUE: 'O25-IMP-AI-12510|one',
        }),
      },
      {
        vendorLine: line({
          ACCOUNTDISPLAYVALUE: 'Su-000068',
          DOCUMENT: '15902',
          INVOICE: '3939',
          CURRENCYCODE: 'EGP',
          FINTAGDISPLAYVALUE: 'O25-IMP-AI-12510|two',
        }),
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });
});
