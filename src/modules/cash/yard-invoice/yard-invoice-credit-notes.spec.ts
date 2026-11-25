import { YardOffsetAccountResolution } from './yard-invoice-account.resolver';
import { aggregateYardInvoiceRecords } from './yard-invoice-aggregation';
import { parseDecimalToMicro } from './yard-invoice-decimal';
import { isYardCreditNotesEnabled } from './yard-invoice-flow';
import { YardInvoiceMetadata } from './yard-invoice-lookup.types';
import { buildYardCashInSourceRows } from './yard-invoice-posting-adapter';
import { yardBatchRowFromStoredRecord } from './yard-invoice-posting-recheck';
import { YardPaymentRecord } from './yard-invoice-record';
import {
  isYardCreditNoteLine,
  isYardReceiptLine,
  planYardSettlements,
  yardInvoiceOf,
  YardJournalLine,
  YardOpenInvoice,
} from './yard-invoice-settlement.service';
import { validateYardInvoiceGroups } from './yard-invoice-validation';

const CN = '000000382/YD-CN';

function rec(overrides: Partial<YardPaymentRecord> = {}): YardPaymentRecord {
  return {
    format: 'YARDS_SOURCE',
    sourceSheet: 'Sheet1',
    layoutId: 'YARDS_LAYOUT_CUR_SAFE',
    sourceRow: 3,
    paymentSerial: null,
    paymentDate: '2026-09-15',
    paymentType: 'Cash',
    rawPaymentType: 'CASH',
    amount: parseDecimalToMicro('-1490'),
    amountText: '-1490',
    currencyCode: 'EGP',
    paymentReference: '',
    safeBankAccount: 'Yard Eagle EG',
    invoiceNumber: CN,
    workbookCustomerAccount: '101002174',
    workbookCustomerName: null,
    workbookDimension: null,
    workbookFinTag: null,
    isCreditNote: true,
    ...overrides,
  } as YardPaymentRecord;
}

function metadata(
  overrides: Partial<YardInvoiceMetadata> = {},
): YardInvoiceMetadata {
  return {
    invoiceNumber: CN,
    company: 'm-p',
    invoiceIdentifier: '5638162017',
    customerAccount: '101002174',
    currencyCode: 'EGP',
    defaultDimensionDisplayValue:
      '|2401|024|002|018|101002174|101002174|||00002|3171|3171|Payable|||Domestic||||',
    financialTagDisplayValue:
      '||MSC LINE|||MSDU7972370|40HC|||||||||||46280|46280|',
    voucher: 'CN-000007462',
    // The open credit, as a positive size.
    openBalance: parseDecimalToMicro('1490'),
    ...overrides,
  };
}

const safe: YardOffsetAccountResolution = {
  status: 'OK',
  accountType: 'Petty cash',
  accountDisplayValue: 'Yard Eagle EG',
  message: '',
  retryable: false,
};

describe('Yard credit notes: aggregation', () => {
  it('blocks a credit note when the flow does not allow them (default)', () => {
    const { groups } = aggregateYardInvoiceRecords([rec()]);
    expect(groups[0].errors.join(' ')).toContain('not supported');
  });

  it('accepts a credit note when allowed, with a negative total', () => {
    const { groups } = aggregateYardInvoiceRecords([rec()], {
      allowCreditNotes: true,
    });
    expect(groups[0].errors).toEqual([]);
    expect(groups[0].isCreditNote).toBe(true);
    expect(groups[0].roundedTotal).toBe(parseDecimalToMicro('-1490'));
  });

  it('blocks a credit note row that is not negative', () => {
    const { groups } = aggregateYardInvoiceRecords(
      [rec({ amount: parseDecimalToMicro('1490'), amountText: '1490' })],
      { allowCreditNotes: true },
    );
    expect(groups[0].errors.join(' ')).toContain(
      'every row must be a negative amount',
    );
  });
});

describe('Yard credit notes: validation and rows', () => {
  const group = () =>
    aggregateYardInvoiceRecords([rec()], { allowCreditNotes: true }).groups[0];

  it('compares the size of the credit total with the open credit', () => {
    const lookups = new Map([
      [CN, { status: 'FOUND' as const, metadata: metadata() }],
    ]);
    const offsets = new Map([[CN, safe]]);
    const ok = validateYardInvoiceGroups({
      groups: [group()],
      lookups,
      offsetAccounts: offsets,
      templateIssues: [],
      aggregationIssues: [],
    });
    expect(ok.groups[0].errors).toEqual([]);

    const tooBig = validateYardInvoiceGroups({
      groups: [group()],
      lookups: new Map([
        [
          CN,
          {
            status: 'FOUND' as const,
            metadata: metadata({ openBalance: parseDecimalToMicro('1000') }),
          },
        ],
      ]),
      offsetAccounts: offsets,
      templateIssues: [],
      aggregationIssues: [],
    });
    expect(tooBig.groups[0].errors.join(' ')).toContain('total 1490');
  });

  it('builds a customer debit against the safe, described as a credit note', () => {
    const { rows } = buildYardCashInSourceRows([
      { group: group(), metadata: metadata(), offsetAccount: safe },
    ]);
    const row = rows[0] as unknown as Record<string, unknown>;
    expect(row).toMatchObject({
      DESCRIPTION: `Yard credit note ${CN}`,
      ACCOUNTTYPE: 'Cust',
      ACCOUNTDISPLAYVALUE: '101002174',
      OFFSETACCOUNTTYPE: 'Petty cash',
      OFFSETACCOUNTDISPLAYVALUE: 'Yard Eagle EG',
      DEBITAMOUNT: 1490,
      CREDITAMOUNT: 0,
      INVOICE: CN,
    });
  });

  it('reads a stored credit note line back for the pre-post check', () => {
    const { row } = yardBatchRowFromStoredRecord({
      Description: `Yard credit note ${CN}`,
      DebitAmount: 1490,
      CreditAmount: 0,
    });
    expect(row.invoiceNumber).toBe(CN);
    expect(row.amount).toBe(1490);
  });
});

describe('Yard credit notes: settlement', () => {
  const line = (overrides: Partial<YardJournalLine> = {}): YardJournalLine => ({
    LineNumber: 1085,
    TransactionText: `Yard credit note ${CN}`,
    AccountDisplayValue: '101002174',
    CreditAmount: 0,
    DebitAmount: 1490,
    CurrencyCode: 'EGP',
    ...overrides,
  });
  const open = (overrides: Partial<YardOpenInvoice> = {}): YardOpenInvoice => ({
    Invoice: CN,
    AccountNum: '101002174',
    CurrencyCode: 'EGP',
    AmountCur: -1490,
    SettleAmountCur: 0,
    Voucher: 'CN-000007462',
    Closed: '1900-01-01T12:00:00Z',
    DueDate: '2026-09-15T12:00:00Z',
    ...overrides,
  });

  it('recognises a credit note line and reads its number', () => {
    expect(isYardCreditNoteLine(line())).toBe(true);
    expect(isYardReceiptLine(line())).toBe(true);
    expect(yardInvoiceOf(line())).toBe(CN);
  });

  it('plans a negative mark on the open credit note', () => {
    const { plan, problems } = planYardSettlements(
      [line()],
      new Map([[CN, [open()]]]),
    );
    expect(problems).toEqual([]);
    expect(plan).toEqual([
      {
        journalLineNumber: 1085,
        invoiceNumber: CN,
        amount: -1490,
        dueDate: '2026-09-15T12:00:00Z',
      },
    ]);
  });

  it('does not settle a credit note line against a positive invoice row', () => {
    const { plan, problems } = planYardSettlements(
      [line()],
      new Map([[CN, [open({ AmountCur: 1490 })]]]),
    );
    expect(plan).toEqual([]);
    expect(problems.join(' ')).toContain('no open invoice');
  });

  it('keeps receipts settling with a positive amount', () => {
    const { plan } = planYardSettlements(
      [
        line({
          TransactionText: 'Yard receipt 000073431/YD',
          CreditAmount: 1490,
          DebitAmount: 0,
        }),
      ],
      new Map([
        [
          '000073431/YD',
          [
            open({
              Invoice: '000073431/YD',
              AmountCur: 1490,
              Voucher: 'Rev-1',
            }),
          ],
        ],
      ]),
    );
    expect(plan[0].amount).toBe(1490);
  });
});

describe('Yard credit notes flag', () => {
  it('is off unless set to true, 1 or yes', () => {
    expect(isYardCreditNotesEnabled({})).toBe(false);
    expect(
      isYardCreditNotesEnabled({ YARD_CREDIT_NOTES_ENABLED: 'true' }),
    ).toBe(true);
  });
});
