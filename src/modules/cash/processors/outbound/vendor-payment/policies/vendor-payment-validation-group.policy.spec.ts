import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { groupVendorPaymentValidationLines } from './vendor-payment-validation-group.policy';

const line = (overrides: Record<string, unknown>) =>
  Object.assign(Object.create(CashEntryRawDataModel.prototype), {
    UniqueId: 503378,
    LINENUMBER: 1,
    ACCOUNTDISPLAYVALUE: 'Su-000093',
    DOCUMENT: '20026',
    INVOICE: 'emp_2',
    CURRENCYCODE: 'EGP',
    DEBITAMOUNT: 563.13,
    ...overrides,
  }) as CashEntryRawDataModel;

describe('groupVendorPaymentValidationLines', () => {
  it('groups repeated invoice portions from one source transaction', () => {
    const result = groupVendorPaymentValidationLines([
      line({ LINENUMBER: 18714 }),
      line({ LINENUMBER: 18715 }),
      line({ LINENUMBER: 18716 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(3);
    expect(
      result[0].reduce((sum, item) => sum + Number(item.DEBITAMOUNT), 0),
    ).toBeCloseTo(1689.39, 2);
  });

  it('does not combine different documents or invoices', () => {
    const result = groupVendorPaymentValidationLines([
      line({ DOCUMENT: '20026', INVOICE: 'emp_2' }),
      line({ DOCUMENT: '20027', INVOICE: 'emp_2' }),
      line({ DOCUMENT: '20026', INVOICE: 'emp_3' }),
    ]);

    expect(result).toHaveLength(3);
  });
});
