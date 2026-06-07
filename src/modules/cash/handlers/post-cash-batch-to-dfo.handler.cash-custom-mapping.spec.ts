import { PostCashBatchToDFOHandler } from './post-cash-batch-to-dfo.handler';

describe('PostCashBatchToDFOHandler - cash custom line mapping', () => {
  const buildHandler = () =>
    new PostCashBatchToDFOHandler({} as any, {} as any);

  it('maps cash-in dyn line into custom API body (strict key casing)', () => {
    const handler = buildHandler();

    const result = (handler as any).mapLines(
      [
        {
          data: {
            dataAreaId: 'USMF',
            JournalBatchNumber: 'JN000123',
            LineNumber: 1,
            AccountType: 'Cust',
            AccountDisplayValue: 'CUST001',
            OffsetAccountDisplayValue: 'BANK001',
            OffsetAccountType: 'Bank',
            OffsetCompany: 'USMF',
            DefaultDimensionsForAccountDisplayValue: 'BU-001|CC-002|Dept-003',
            DefaultDimensionsForOffsetAccountDisplayValue:
              'BU-001|CC-002|Dept-004',
            TransactionDate: '2026-04-21T00:00:00.000Z',
            ExchangeRate: 1,
            CreditAmount: 1000,
            DebitAmount: 0,
            CurrencyCode: 'USD',
            VoucherType: 'transfer',
            FinTagDisplayValue: 'TAG1',
            ItemWithholdingTaxGroupCode: 'TAX1',
            SalesTaxGroup: 'TG1',
            ItemSalesTaxGroup: 'TIG1',
            OffsetFinTagDisplayValue: 'TAG2',
            OffsetTransactionText: 'Offset text',
            PostingProfile: 'PP1',
            PaymentId: 'PAY123',
            PaymentReference: 'REF123',
            SafeType: 'Spec',
            TransactionText: 'Customer payment',
            MarkedInvoice: 'INV-0001',
            Voucher: '',
            OffsetTransactionText: 'Offset text',
          },
        },
      ],
      'USMF',
      'in',
    );

    expect(result[0].customLineApiBody).toBeDefined();
    const body = result[0].customLineApiBody;

    expect(body).toHaveProperty('journalNum', '');
    expect(body).toHaveProperty('AccountNum', 'CUST001');
    expect(body).toHaveProperty('accountTypeStr', 'Cust');
    expect(body).toHaveProperty('transDate', '2026-04-21T00:00:00');
  });

  it('maps cash-out dyn line into custom API body (Vendor endpoint semantics)', () => {
    const handler = buildHandler();

    const result = (handler as any).mapLines(
      [
        {
          data: {
            dataAreaId: 'USMF',
            JournalBatchNumber: 'JN000123',
            LineNumber: 1,
            AccountType: 'Vend',
            AccountDisplayValue: 'VEND001',
            OffsetAccountDisplayValue: 'BANK001',
            OffsetAccountType: 'Bank',
            OffsetCompany: 'USMF',
            DefaultDimensionsForAccountDisplayValue: 'BU-001|CC-002|Dept-003',
            DefaultDimensionsForOffsetAccountDisplayValue:
              'BU-001|CC-002|Dept-004',
            TransactionDate: '2026-04-21T00:00:00.000Z',
            ExchangeRate: 1,
            CreditAmount: 0,
            DebitAmount: 1000,
            CurrencyCode: 'USD',
            VoucherType: 'transfer',
            FinTagDisplayValue: 'TAG1',
            ItemWithholdingTaxGroupCode: 'TAX1',
            SalesTaxGroup: 'TG1',
            ItemSalesTaxGroup: 'TIG1',
            OffsetFinTagDisplayValue: 'TAG2',
            OffsetTransactionText: 'Offset text',
            PostingProfile: 'PP1',
            PaymentId: 'PAY456',
            PaymentReference: 'REF456',
            SafeType: 'Spec',
            TransactionText: 'Vendor payment',
            MarkedInvoice: 'INV-0002',
            Voucher: '',
          },
        },
      ],
      'USMF',
      'out',
    );

    expect(result[0].customLineApiBody).toBeDefined();
    const body = result[0].customLineApiBody;

    expect(body).toHaveProperty('journalNum', '');
    expect(body).toHaveProperty('AccountNum', 'VEND001');
    expect(body).toHaveProperty('accountTypeStr', 'Vendor');
    expect(body).toHaveProperty('transDate', '2026-04-21T00:00:00');
  });

  it('derives missing default dimension from full ledger account display value', () => {
    const handler = buildHandler();
    const ledgerDisplayValue =
      '223404|2101|021|002|007|101000084|101000084|Tr-000052|Tr-000052|745|12021|12016|Payable|13||DOMESTIC||||';

    const result = (handler as any).mapLines(
      [
        {
          data: {
            dataAreaId: 'USMF',
            JournalBatchNumber: 'JN000123',
            LineNumber: 5,
            AccountType: 'Ledger',
            AccountDisplayValue: ledgerDisplayValue,
            OffsetAccountDisplayValue: ledgerDisplayValue,
            OffsetAccountType: 'Ledger',
            OffsetCompany: 'USMF',
            DefaultDimensionDisplayValue: '',
            OffsetDefaultDimensionDisplayValue:
              '|2101|021|002|007|301000004|301000004|Tr-000052|Tr-000052|745|12015|12016|Payable|13||DOMESTIC||||',
            TransactionDate: '2026-04-21T00:00:00.000Z',
            ExchangeRate: 1,
            CreditAmount: 0,
            DebitAmount: 1000,
            CurrencyCode: 'USD',
            VoucherType: 'transfer',
            PostingProfile: 'Cust-PP',
            PaymentId: 'PAY456',
            PaymentReference: 'REF456',
            TransactionText: 'Vendor payment',
            Voucher: '',
          },
        },
      ],
      'USMF',
      'out',
    );

    expect(result[0].customLineApiBody).toHaveProperty(
      'DEFAULTDIMENSIONDISPLAYVALUE',
      '|2101|021|002|007|101000084|101000084|Tr-000052|Tr-000052|745|12021|12016|Payable|13||DOMESTIC||||',
    );
  });
});

