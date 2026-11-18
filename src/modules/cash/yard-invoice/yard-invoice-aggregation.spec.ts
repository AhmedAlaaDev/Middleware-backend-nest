import { aggregateYardInvoiceRecords } from './yard-invoice-aggregation';
import { parseDecimalToMicro } from './yard-invoice-decimal';
import { YardPaymentRecord } from './yard-invoice-record';

function record(overrides: Partial<YardPaymentRecord> = {}): YardPaymentRecord {
  return {
    format: 'YARDS_SOURCE',
    sourceSheet: 'yard.',
    layoutId: 'YARDS_LAYOUT_REMARK',
    sourceRow: 2,
    paymentSerial: null,
    paymentDate: '2026-07-15',
    paymentType: 'Cash',
    rawPaymentType: 'CASH',
    amount: parseDecimalToMicro('100'),
    amountText: '100',
    currencyCode: 'EGP',
    paymentReference: '',
    safeBankAccount: 'Yard EG',
    invoiceNumber: '000061156/YD',
    workbookCustomerAccount: '101000262',
    workbookCustomerName: null,
    workbookDimension: '|2401|024|002|012|101000262|101000262',
    workbookFinTag: '||MSC LINE|||MSNU7435730',
    isCreditNote: false,
    ...overrides,
  };
}

describe('aggregateYardInvoiceRecords', () => {
  it('consolidates three rows of one invoice across two sheets into one exact sum, keeping every source', () => {
    const result = aggregateYardInvoiceRecords([
      record({
        sourceSheet: 'yard.',
        sourceRow: 2,
        amount: parseDecimalToMicro('1350.0001'),
        amountText: '1350.0001',
      }),
      record({
        sourceSheet: 'yard.',
        sourceRow: 9,
        amount: parseDecimalToMicro('100'),
        amountText: '100',
      }),
      record({
        sourceSheet: 'Atlantic',
        sourceRow: 4,
        amount: parseDecimalToMicro('49.9999'),
        amountText: '49.9999',
        layoutId: 'YARDS_LAYOUT_CUR_SAFE',
      }),
    ]);
    expect(result.issues).toEqual([]);
    expect(result.groups).toHaveLength(1);
    const [group] = result.groups;
    expect(group.rawTotalText).toBe('1500.00');
    expect(group.roundedTotalText).toBe('1500.00');
    expect(group.roundingChangeText).toBe('0.00');
    expect(group.sourceRefs).toEqual(['yard.!2', 'yard.!9', 'Atlantic!4']);
    expect(group.sources.map((s) => s.amountText)).toEqual([
      '1350.0001',
      '100',
      '49.9999',
    ]);
    expect(group.errors).toEqual([]);
  });

  it('keeps distinct invoice numbers as separate groups', () => {
    const { groups } = aggregateYardInvoiceRecords([
      record({ invoiceNumber: '000061156/YD' }),
      record({ invoiceNumber: '000061157/YD', sourceRow: 3 }),
    ]);
    expect(groups.map((g) => g.invoiceNumber).sort()).toEqual([
      '000061156/YD',
      '000061157/YD',
    ]);
  });

  it('blocks distinct invoice texts that collide after normalization, and never merges them', () => {
    const { groups, issues } = aggregateYardInvoiceRecords([
      record({ invoiceNumber: 'ABC/YD', sourceRow: 2 }),
      record({ invoiceNumber: 'abc/yd', sourceRow: 3 }),
      record({ invoiceNumber: 'DEF/YD', sourceRow: 4 }),
    ]);
    expect(groups.map((g) => g.invoiceNumber)).toEqual(['DEF/YD']);
    expect(issues.filter((i) => /collide/.test(i.message))).toHaveLength(2);
  });

  it('marks a group whose rows disagree on currency, safe or reference instead of choosing one', () => {
    const { groups } = aggregateYardInvoiceRecords([
      record({ sourceRow: 2 }),
      record({
        sourceRow: 3,
        currencyCode: 'USD',
        safeBankAccount: 'QNB-US-CA2',
        paymentReference: 'ref',
      }),
    ]);
    const text = groups[0].errors.join(' ');
    expect(text).toContain('disagree on currencyCode');
    expect(text).toContain('disagree on safeBankAccount');
    expect(text).toContain('disagree on paymentReference');
  });

  it('marks a group whose rows carry different workbook customer, dimension or tag values', () => {
    const { groups } = aggregateYardInvoiceRecords([
      record({ sourceRow: 2 }),
      record({
        sourceRow: 3,
        workbookDimension: '|2401|024|002|012|101000263|101000263',
        workbookFinTag: '||OTHER',
      }),
    ]);
    const text = groups[0].errors.join(' ');
    expect(text).toContain('workbook workbookDimension');
    expect(text).toContain('workbook workbookFinTag');
    expect(groups[0].workbookDimensions).toHaveLength(2);
  });

  it('blocks a repeated PaymentSerial in the template format', () => {
    const { groups, issues } = aggregateYardInvoiceRecords([
      record({
        format: 'TEMPLATE_8',
        sourceSheet: 'Template',
        layoutId: 'TEMPLATE_8',
        paymentSerial: 'PS-DUP',
        invoiceNumber: 'INV-1',
        sourceRow: 2,
      }),
      record({
        format: 'TEMPLATE_8',
        sourceSheet: 'Template',
        layoutId: 'TEMPLATE_8',
        paymentSerial: 'PS-DUP',
        invoiceNumber: 'INV-2',
        sourceRow: 3,
      }),
    ]);
    expect(issues.some((i) => /PS-DUP/.test(i.message))).toBe(true);
    expect(groups.every((g) => g.errors.length > 0)).toBe(true);
  });

  it('flags a credit-note group as not submittable and reports it as a credit note', () => {
    const { groups } = aggregateYardInvoiceRecords([
      record({
        invoiceNumber: '000000356/YD-CN',
        amount: -parseDecimalToMicro('2740'),
        amountText: '-2740',
        isCreditNote: true,
      }),
    ]);
    expect(groups[0].isCreditNote).toBe(true);
    expect(groups[0].errors.join(' ')).toMatch(/credit note \(-CN\)/);
  });

  it('reports the rounding change and variance of a four-decimal total', () => {
    const { groups } = aggregateYardInvoiceRecords([
      record({
        amount: parseDecimalToMicro('1350.0001'),
        amountText: '1350.0001',
      }),
    ]);
    const [group] = groups;
    expect(group.roundedTotalText).toBe('1350.00');
    expect(group.roundingChangeText).toBe('-0.0001');
    expect(group.roundingVarianceText).toBe('0.0001');
    expect(group.errors).toEqual([]);
  });

  it('rounds an exact half minor unit up and records the change', () => {
    const { groups } = aggregateYardInvoiceRecords([
      record({ amount: parseDecimalToMicro('1.005'), amountText: '1.005' }),
    ]);
    expect(groups[0].roundedTotalText).toBe('1.01');
    expect(groups[0].roundingChangeText).toBe('0.005');
    expect(groups[0].errors).toEqual([]);
  });
});
