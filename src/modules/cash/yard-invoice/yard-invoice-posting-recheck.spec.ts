import {
  compareYardBatchRowToD365,
  YardBatchRowSnapshot,
  yardBatchRowFromStoredRecord,
} from './yard-invoice-posting-recheck';

const DIMENSION =
  '|2401|024|002|019|101011024|101011024|||00002|3171|3171|Payable|||Domestic||||';
const TAG = '||MSC LINE|||TCLU7736429|40HC|||||||||||46204|46204|';

function row(
  overrides: Partial<YardBatchRowSnapshot> = {},
): YardBatchRowSnapshot {
  return {
    invoiceNumber: 'INV-1',
    customerAccount: '101011024',
    defaultDimension: DIMENSION,
    financialTag: TAG,
    offsetAccount: 'Yard Eagle EG',
    paymentType: 'Cash',
    paymentDate: '2026-07-01',
    currencyCode: 'EGP',
    amount: 1370,
    ...overrides,
  };
}

function found(overrides: Record<string, unknown> = {}) {
  return {
    status: 'FOUND' as const,
    metadata: {
      invoiceNumber: 'INV-1',
      company: 'm-p',
      invoiceIdentifier: '1',
      customerAccount: '101011024',
      currencyCode: 'EGP',
      defaultDimensionDisplayValue: DIMENSION,
      financialTagDisplayValue: TAG,
      voucher: 'Rev-1',
      openBalance: BigInt(1370000000),
      ...overrides,
    },
  };
}

const OK_OFFSET = {
  status: 'OK',
  accountType: 'Petty cash',
  accountDisplayValue: 'Yard Eagle EG',
  message: '',
  retryable: false,
} as const;

describe('compareYardBatchRowToD365', () => {
  it('reports no problem when the uploaded row still matches D365', () => {
    expect(
      compareYardBatchRowToD365(row(), found() as never, OK_OFFSET as never),
    ).toEqual([]);
  });

  it('blocks a customer, dimension or tag that changed in D365', () => {
    expect(
      compareYardBatchRowToD365(
        row(),
        found({ customerAccount: '999' }) as never,
        OK_OFFSET as never,
      )[0],
    ).toMatch(/customer changed/);
    expect(
      compareYardBatchRowToD365(
        row(),
        found({
          defaultDimensionDisplayValue: DIMENSION.replace('00002', '00019'),
        }) as never,
        OK_OFFSET as never,
      )[0],
    ).toMatch(/default dimension changed/);
    expect(
      compareYardBatchRowToD365(
        row(),
        found({ financialTagDisplayValue: '||MSC LINE|||OTHER|' }) as never,
        OK_OFFSET as never,
      )[0],
    ).toMatch(/financial tag changed/);
  });

  it('blocks when the lookup no longer resolves or the offset account is not valid', () => {
    expect(
      compareYardBatchRowToD365(
        row(),
        { status: 'NOT_FOUND' } as never,
        OK_OFFSET as never,
      )[0],
    ).toMatch(/lookup no longer resolves/);
    expect(
      compareYardBatchRowToD365(
        row(),
        found() as never,
        { ...OK_OFFSET, status: 'NOT_FOUND' } as never,
      )[0],
    ).toMatch(/offset account .* no longer valid/);
  });

  it('blocks an amount above the open balance, and does not guess when the balance is unknown', () => {
    expect(
      compareYardBatchRowToD365(
        row({ amount: 2000 }),
        found() as never,
        OK_OFFSET as never,
      ),
    ).toEqual([expect.stringMatching(/exceeds the open balance/)]);
    expect(
      compareYardBatchRowToD365(
        row(),
        found({ openBalance: null }) as never,
        OK_OFFSET as never,
      ),
    ).toEqual([]);
  });
});

describe('yardBatchRowFromStoredRecord', () => {
  it('reads the invoice and fields from the stored PascalCase names', () => {
    const { lineNumber, row } = yardBatchRowFromStoredRecord({
      Invoice: 'INV-1001',
      LineNumber: 7,
      AccountDisplayValue: ' CUST-01 ',
      DefaultDimensionsForAccountDisplayValue: DIMENSION,
      FinTagDisplayValue: TAG,
      OffsetAccountDisplayValue: 'SAFE-BANK',
      VoucherType: 'Bank',
      TransactionDate: '2026-11-01',
      CurrencyCode: 'USD',
      CreditAmount: 1250.5,
    });
    expect(lineNumber).toBe(7);
    expect(row).toEqual({
      invoiceNumber: 'INV-1001',
      customerAccount: 'CUST-01',
      defaultDimension: DIMENSION,
      financialTag: TAG,
      offsetAccount: 'SAFE-BANK',
      paymentType: 'Bank',
      paymentDate: '2026-11-01',
      currencyCode: 'USD',
      amount: 1250.5,
    });
  });

  it('falls back to MarkedInvoice, then to the Yard receipt description', () => {
    expect(
      yardBatchRowFromStoredRecord({ MarkedInvoice: 'INV-2' }).row.invoiceNumber,
    ).toBe('INV-2');
    expect(
      yardBatchRowFromStoredRecord({ Description: 'Yard receipt INV-3' }).row
        .invoiceNumber,
    ).toBe('INV-3');
  });

  it('does not read the uppercase upload names that stored records do not have', () => {
    const { row } = yardBatchRowFromStoredRecord({
      INVOICE: 'INV-OLD',
      ACCOUNTDISPLAYVALUE: 'CUST-OLD',
    });
    expect(row.invoiceNumber).toBe('');
    expect(row.customerAccount).toBe('');
  });
});
