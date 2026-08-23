import { VendorPaymentLineBuilder } from './vendor-payment-line.builder';

function line(overrides: Record<string, unknown>): any {
  return {
    LINENUMBER: 1,
    UniqueId: 1,
    IsVendor: false,
    ACCOUNTTYPE: '',
    ACCOUNTDISPLAYVALUE: '',
    VendorGroup: 'Normal',
    DEBITAMOUNT: 0,
    CREDITAMOUNT: 0,
    DOCUMENT: 'DOC-1',
    INVOICE: '',
    MARKEDINVOICE: '',
    CURRENCYCODE: 'EGP',
    FINTAGDISPLAYVALUE: 'OP-1|',
    ...overrides,
  };
}

describe('VendorPaymentLineBuilder', () => {
  it('builds one source-amount journal line per distinct invoice', () => {
    const buildVendorLine = jest.fn((...args: any[]) => ({ args }));
    const builder = new VendorPaymentLineBuilder(buildVendorLine as any);
    const offset = line({
      LINENUMBER: 2,
      ACCOUNTTYPE: 'Petty cash',
      ACCOUNTDISPLAYVALUE: 'CASH-1',
      CREDITAMOUNT: 555,
    });

    const result = builder.build('466695', [
      line({
        LINENUMBER: 45,
        IsVendor: true,
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'Sl-000020',
        INVOICE: '2025001409',
        DEBITAMOUNT: 300,
      }),
      offset,
      line({
        LINENUMBER: 47,
        IsVendor: true,
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'Sl-000020',
        INVOICE: '2025011317',
        DEBITAMOUNT: 255,
      }),
    ] as any[]);

    expect(result).toHaveLength(2);
    expect(buildVendorLine).toHaveBeenCalledTimes(2);
    expect(buildVendorLine.mock.calls.map((call) => call[2])).toEqual([
      offset,
      offset,
    ]);
    expect(buildVendorLine.mock.calls.map((call) => call[3])).toEqual([
      'ACCOUNT',
      'ACCOUNT',
    ]);
    expect(
      buildVendorLine.mock.calls.map((call) => call[1].DEBITAMOUNT),
    ).toEqual([300, 255]);
    expect(
      buildVendorLine.mock.calls.map((call) =>
        call[5].map((settlement: any) => settlement.vendorLine.INVOICE),
      ),
    ).toEqual([['2025001409'], ['2025011317']]);
  });

  it('aggregates repeated source rows of the same invoice into one line', () => {
    const buildVendorLine = jest.fn((...args: any[]) => ({ args }));
    const builder = new VendorPaymentLineBuilder(buildVendorLine as any);

    const result = builder.build('same-invoice', [
      line({
        LINENUMBER: 1,
        IsVendor: true,
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'Su-000005',
        INVOICE: 'awb1047544',
        DEBITAMOUNT: 400,
      }),
      line({ CREDITAMOUNT: 1000, ACCOUNTTYPE: 'Petty cash' }),
      line({
        LINENUMBER: 3,
        IsVendor: true,
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'Su-000005',
        INVOICE: 'AWB1047544',
        DEBITAMOUNT: 600,
      }),
    ] as any[]);

    expect(result).toHaveLength(1);
    expect(buildVendorLine.mock.calls[0][1].DEBITAMOUNT).toBe(1000);
    expect(buildVendorLine.mock.calls[0][5]).toHaveLength(2);
  });

  it('preserves source-driven grouped payment and companion lines when withholding exists', () => {
    const buildVendorLine = jest.fn((...args: any[]) => ({ args }));
    const builder = new VendorPaymentLineBuilder(buildVendorLine as any);
    const vendor = line({
      IsVendor: true,
      ACCOUNTTYPE: 'Vend',
      ACCOUNTDISPLAYVALUE: 'Tr-000031',
      INVOICE: '374',
      DEBITAMOUNT: 16823.04,
    });
    const payment = line({
      ACCOUNTTYPE: 'Bank',
      CREDITAMOUNT: 16455.78,
    });
    const withholding = line({
      ACCOUNTTYPE: 'Ledger',
      ACCOUNTDISPLAYVALUE: '223304',
      CREDITAMOUNT: 367.26,
      INVOICE: '374',
    });

    const result = builder.build('withholding', [
      vendor,
      payment,
      withholding,
    ] as any[]);

    expect(result).toHaveLength(2);
    expect(buildVendorLine.mock.calls.map((call) => call[2])).toEqual([
      payment,
      withholding,
    ]);
    expect(buildVendorLine.mock.calls.map((call) => call[3])).toEqual([
      'OFFSET',
      'OFFSET',
    ]);
    expect(payment.CREDITAMOUNT).toBe(16455.78);
    expect(withholding.CREDITAMOUNT).toBe(367.26);
    expect(payment.CREDITAMOUNT + withholding.CREDITAMOUNT).toBeCloseTo(
      vendor.DEBITAMOUNT,
      2,
    );
    expect(buildVendorLine.mock.calls[0][7]).toBeUndefined();
    expect(buildVendorLine.mock.calls[1][7]).toBeUndefined();
  });

  it('rejects explicit withholding when main plus withholding does not equal the Vendor total', () => {
    const buildVendorLine = jest.fn((...args: any[]) => ({ args }));
    const builder = new VendorPaymentLineBuilder(buildVendorLine as any);

    const result = builder.build('unbalanced-withholding', [
      line({
        IsVendor: true,
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'Tr-000031',
        INVOICE: '374',
        DEBITAMOUNT: 1000,
      }),
      line({ ACCOUNTTYPE: 'Bank', CREDITAMOUNT: 900 }),
      line({
        ACCOUNTTYPE: 'Ledger',
        ACCOUNTDISPLAYVALUE: '223304',
        CREDITAMOUNT: 50,
        INVOICE: '374',
      }),
    ] as any[]);

    expect(buildVendorLine).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].GetErrors()).toEqual(
      expect.arrayContaining([expect.stringContaining('WithholdingBalance:')]),
    );
  });

  it('does not apply invoice splitting to custody-vendor settlement targets', () => {
    const buildVendorLine = jest.fn((...args: any[]) => ({ args }));
    const builder = new VendorPaymentLineBuilder(buildVendorLine as any);
    const payment = line({ ACCOUNTTYPE: 'Bank', CREDITAMOUNT: 100 });

    const result = builder.build('custody', [
      line({
        IsVendor: true,
        VendorGroup: 'Custody',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'CUSTODY-1',
        INVOICE: 'CUSTODY-VCH-1',
        DOCUMENT: 'DOC-CUSTODY-1',
        DEBITAMOUNT: 60,
      }),
      payment,
      line({
        LINENUMBER: 3,
        IsVendor: true,
        VendorGroup: 'Custody',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'CUSTODY-1',
        INVOICE: 'CUSTODY-VCH-2',
        DOCUMENT: 'DOC-CUSTODY-2',
        DEBITAMOUNT: 40,
      }),
    ] as any[]);

    expect(result).toHaveLength(1);
    expect(buildVendorLine.mock.calls[0][2]).toBe(payment);
    expect(buildVendorLine.mock.calls[0][3]).toBe('OFFSET');
    expect(buildVendorLine.mock.calls[0][5]).toHaveLength(2);
  });
});
