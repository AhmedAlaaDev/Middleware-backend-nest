import {
  compareYardBatchRowToD365,
  YardBatchRowSnapshot,
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
