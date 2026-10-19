import { CashOutEntryBuilder } from './cash-out-entry.builder';

describe('CashOutEntryBuilder', () => {
  const strategy = (value: string) => ({
    build: jest.fn(() => [value] as any),
  });

  it.each([
    ['Vendor Payment', { IsVendorPayment: true }, 'vendor'],
    ['Custody Settlement', { IsCustodySettlement: true }, 'settlement'],
    ['Custody Issue', { IsCustodyIssue: true }, 'issue'],
  ])('delegates %s to its feature strategy', (safeType, flags, expected) => {
    const vendor = strategy('vendor');
    const settlement = strategy('settlement');
    const issue = strategy('issue');
    const source = jest.fn(() => 'source' as any);
    const line = { SafeType: safeType, ...flags } as any;
    const builder = new CashOutEntryBuilder(vendor, settlement, issue, source);

    expect(builder.build('1', [line])).toEqual([expected]);
    expect(source).not.toHaveBeenCalled();
  });

  it('uses common source-line construction for other Cash-Out types', () => {
    const source = jest.fn((_id, line) => line as any);
    const line = { SafeType: 'Other' } as any;
    const builder = new CashOutEntryBuilder(
      strategy('vendor'),
      strategy('settlement'),
      strategy('issue'),
      source,
    );

    expect(builder.build('1', [line])).toEqual([line]);
  });

  it('formats DownPayment customer + petty cash as Custody Settlement', () => {
    const settlement = strategy('settlement');
    const source = jest.fn((_id, line) => line as any);
    const builder = new CashOutEntryBuilder(
      strategy('vendor'),
      settlement,
      strategy('issue'),
      source,
    );
    const customer = {
      SafeType: 'DownPayment',
      IsCustomer: true,
      ACCOUNTTYPE: 'Cust',
      ACCOUNTDISPLAYVALUE: '101000997',
      DEBITAMOUNT: 1710,
      CREDITAMOUNT: 0,
      OFFSETACCOUNTDISPLAYVALUE: '',
    } as any;
    const pettyCash = {
      SafeType: 'DownPayment',
      IsPettyCash: true,
      ACCOUNTTYPE: 'Petty cash',
      ACCOUNTDISPLAYVALUE: 'ALEXHO EG',
      DEBITAMOUNT: 0,
      CREDITAMOUNT: 1710,
    } as any;

    expect(builder.build('485664', [customer, pettyCash])).toEqual([
      'settlement',
    ]);
    expect(settlement.build).toHaveBeenCalledTimes(1);
    expect(source).not.toHaveBeenCalled();
    expect(customer.SafeType).toBe('Custody Settlement');
    expect(customer.IsCustodySettlement).toBe(true);
    expect(pettyCash.SafeType).toBe('Custody Settlement');
  });
});
