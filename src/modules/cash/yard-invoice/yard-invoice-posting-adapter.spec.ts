import { YardOffsetAccountResolution } from './yard-invoice-account.resolver';
import {
  aggregateYardInvoiceRecords,
  YardInvoiceGroup,
} from './yard-invoice-aggregation';
import { parseDecimalToMicro } from './yard-invoice-decimal';
import { YardInvoiceMetadata } from './yard-invoice-lookup.types';
import {
  buildYardCashInSourceRows,
  YardPostingAdapterInput,
} from './yard-invoice-posting-adapter';
import { YardPaymentRecord } from './yard-invoice-record';

import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { collectCashInDirectSourceErrors } from '@/modules/cash/processors/inbound/direct/cash-in-direct-line.validator';

function rec(overrides: Partial<YardPaymentRecord> = {}): YardPaymentRecord {
  return {
    format: 'TEMPLATE_8',
    sourceSheet: 'Template',
    layoutId: 'TEMPLATE_8',
    sourceRow: 2,
    paymentSerial: 'PS-1',
    paymentDate: '2026-07-15',
    paymentType: 'Cash',
    rawPaymentType: 'Cash',
    amount: parseDecimalToMicro('100'),
    amountText: '100',
    currencyCode: 'EGP',
    paymentReference: 'REF-1',
    safeBankAccount: '  Yard Safe  ',
    invoiceNumber: '000061156/YD',
    workbookCustomerAccount: null,
    workbookCustomerName: null,
    workbookDimension: null,
    workbookFinTag: null,
    isCreditNote: false,
    ...overrides,
  };
}

function metadata(
  overrides: Partial<YardInvoiceMetadata> = {},
): YardInvoiceMetadata {
  return {
    invoiceNumber: '000061156/YD',
    company: 'm-p',
    invoiceIdentifier: '5637743016',
    customerAccount: '101000262',
    currencyCode: 'EGP',
    defaultDimensionDisplayValue:
      '|2401|024|002|012|101000262|101000262|||00002',
    financialTagDisplayValue: '||MSC LINE|||MSNU7435730',
    voucher: 'V-1',
    openBalance: parseDecimalToMicro('10000'),
    ...overrides,
  };
}

function account(
  accountType: 'Petty cash' | 'Bank',
  display = 'Yard Safe',
): YardOffsetAccountResolution {
  return {
    status: 'OK',
    accountType,
    accountDisplayValue: display,
    message: '',
    retryable: false,
  };
}

function groupOf(records: YardPaymentRecord[]): YardInvoiceGroup {
  const { groups } = aggregateYardInvoiceRecords(records);
  if (groups.length !== 1) throw new Error('fixture must produce one group');
  return groups[0];
}

function inputFor(
  group: YardInvoiceGroup,
  offset: YardOffsetAccountResolution,
  meta = metadata({ invoiceNumber: group.invoiceNumber }),
): YardPostingAdapterInput {
  return { group, metadata: meta, offsetAccount: offset };
}

describe('buildYardCashInSourceRows', () => {
  it('consolidates three same-invoice rows into one business row whose amount is their exact sum', () => {
    const group = groupOf([
      rec({
        sourceRow: 2,
        paymentSerial: 'PS-1',
        amount: parseDecimalToMicro('1350.0001'),
        amountText: '1350.0001',
      }),
      rec({
        sourceRow: 3,
        paymentSerial: 'PS-2',
        amount: parseDecimalToMicro('100'),
        amountText: '100',
      }),
      rec({
        sourceRow: 4,
        paymentSerial: 'PS-3',
        amount: parseDecimalToMicro('49.9999'),
        amountText: '49.9999',
      }),
    ]);
    const { rows, mapping } = buildYardCashInSourceRows([
      inputFor(group, account('Petty cash')),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].CREDITAMOUNT).toBe(1500);
    expect(mapping[0]).toMatchObject({
      invoiceNumber: '000061156/YD',
      sourceRefs: ['Template!2', 'Template!3', 'Template!4'],
      paymentSerials: ['PS-1', 'PS-2', 'PS-3'],
      roundedTotalText: '1500.00',
    });
  });

  it('maps the trimmed SAFE value to OFFSETACCOUNTDISPLAYVALUE and sets the offset type', () => {
    const group = groupOf([rec()]);
    const { rows } = buildYardCashInSourceRows([
      inputFor(group, account('Petty cash')),
    ]);
    expect(rows[0].OFFSETACCOUNTDISPLAYVALUE).toBe('Yard Safe');
    expect(rows[0].OFFSETACCOUNTTYPE).toBe('Petty cash');
  });

  it.each([
    ['Cash', 'Petty cash'],
    ['Cheque', 'Bank'],
    ['Transfer', 'Bank'],
    ['Deposit', 'Bank'],
  ])(
    'uses %s payments with offset type %s and sets VOUCHERTYPE',
    (paymentType, offsetType) => {
      const group = groupOf([rec({ paymentType })]);
      const { rows } = buildYardCashInSourceRows([
        inputFor(group, account(offsetType as 'Petty cash' | 'Bank')),
      ]);
      expect(rows[0].OFFSETACCOUNTTYPE).toBe(offsetType);
      expect(rows[0].VOUCHERTYPE).toBe(paymentType);
    },
  );

  it('builds rows the existing Cash-In direct validator accepts, with D365 customer, tag and dimensions', () => {
    const group = groupOf([rec({ paymentReference: 'REF-1' })]);
    const { rows } = buildYardCashInSourceRows([
      inputFor(group, account('Petty cash')),
    ]);
    const model = new CashEntryRawDataModel(rows[0], 'Yard', true);
    expect(model.ACCOUNTDISPLAYVALUE).toBe('101000262');
    expect(model.DEFAULTDIMENSIONDISPLAYVALUE).toBe(
      '|2401|024|002|012|101000262|101000262|||00002',
    );
    expect(model.FINTAGDISPLAYVALUE).toBe('||MSC LINE|||MSNU7435730');
    expect(model.OFFSETFINTAGDISPLAYVALUE).toBe('||MSC LINE|||MSNU7435730');
    expect(model.TRANSDATE).toBe('2026-07-15');
    expect(model.INVOICE).toBe('000061156/YD');
    expect(model.PAYMENTID).toBe('PS-1');
    expect(model.PAYMENTREFERENCE).toBe('REF-1');
    expect(
      collectCashInDirectSourceErrors(model, { requireInvoice: true }),
    ).toEqual([]);
  });

  it('leaves PAYMENTID empty when the source has no serial (Yards format)', () => {
    const group = groupOf([
      rec({
        format: 'YARDS_SOURCE',
        sourceSheet: 'yard.',
        layoutId: 'YARDS_LAYOUT_REMARK',
        paymentSerial: null,
      }),
    ]);
    const { rows } = buildYardCashInSourceRows([
      inputFor(group, account('Petty cash')),
    ]);
    expect(rows[0].PAYMENTID).toBe('');
  });

  it('refuses an offset account that was not validated', () => {
    const group = groupOf([rec()]);
    expect(() =>
      buildYardCashInSourceRows([
        inputFor(group, {
          ...account('Bank'),
          status: 'NOT_FOUND',
          accountType: null,
        }),
      ]),
    ).toThrow(/offset account not validated/);
  });

  it('refuses metadata that belongs to another invoice', () => {
    const group = groupOf([rec()]);
    expect(() =>
      buildYardCashInSourceRows([
        inputFor(group, account('Bank'), metadata({ invoiceNumber: 'OTHER' })),
      ]),
    ).toThrow(/another invoice/);
  });

  it('refuses metadata with a missing tag or dimension', () => {
    const group = groupOf([rec()]);
    expect(() =>
      buildYardCashInSourceRows([
        inputFor(
          group,
          account('Bank'),
          metadata({ financialTagDisplayValue: '' }),
        ),
      ]),
    ).toThrow(/customer, dimension or tag is missing/);
  });

  it('keeps distinct invoices as separate rows in input order', () => {
    const groups = aggregateYardInvoiceRecords([
      rec({ invoiceNumber: 'A/YD', paymentSerial: 'PS-1' }),
      rec({ invoiceNumber: 'B/YD', paymentSerial: 'PS-2', sourceRow: 3 }),
    ]).groups;
    const { rows, mapping } = buildYardCashInSourceRows(
      groups.map((g) =>
        inputFor(
          g,
          account('Bank'),
          metadata({ invoiceNumber: g.invoiceNumber }),
        ),
      ),
    );
    expect(rows.map((r) => r.INVOICE)).toEqual(['A/YD', 'B/YD']);
    expect(rows.map((r) => r.LINENUMBER)).toEqual([1, 2]);
    expect(mapping.map((m) => m.rowIndex)).toEqual([0, 1]);
  });
});
