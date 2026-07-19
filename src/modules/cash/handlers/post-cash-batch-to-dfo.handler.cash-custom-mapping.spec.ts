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
            SalesTaxGroup: 'Taxable',
            ItemSalesTaxGroup: 'TIG1',
            OffsetFinTagDisplayValue: 'TAG2',
            OffsetTransactionText: 'Offset text',
            PostingProfile: 'Cust-PP',
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
    expect(body).toHaveProperty('TaxGroup', 'Taxable');
    expect(body).toHaveProperty('PostingProfile', 'Cust-PP');
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
            SalesTaxGroup: 'Non-Taxabl',
            ItemSalesTaxGroup: 'TIG1',
            OffsetFinTagDisplayValue: 'TAG2',
            OffsetTransactionText: 'Offset text',
            PostingProfile: 'V-PP',
            PaymentId: 'PAY456',
            PaymentReference: 'REF456',
            SafeType: 'Spec',
            TransactionText: 'Vendor payment',
            Invoice: 'INV-0002',
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
    expect(body).toHaveProperty('PostingProfile', 'V-PP');
    expect(body).toHaveProperty('MARKEDINVOICE', 'INV-0002');
    expect(body).toHaveProperty('TaxGroup', 'Non-Taxabl');
    expect(body).toHaveProperty('debitAmount', 1000);
    expect(body).toHaveProperty('creditAmount', 0);
    expect(body).toHaveProperty('transDate', '2026-04-21T00:00:00');
  });

  it('maps Petty cash / rcash account types to RCash (case-insensitive)', () => {
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
            OffsetAccountDisplayValue: 'CASH001',
            OffsetAccountType: 'Petty cash',
            OffsetCompany: 'USMF',
            DefaultDimensionsForAccountDisplayValue: 'BU-001|CC-002|Dept-003',
            DefaultDimensionsForOffsetAccountDisplayValue:
              'BU-001|CC-002|Dept-004',
            TransactionDate: '2026-04-21T00:00:00.000Z',
            ExchangeRate: 1,
            CreditAmount: 0,
            DebitAmount: 1000,
            CurrencyCode: 'EGP',
            VoucherType: 'cash',
            SalesTaxGroup: 'Non-Taxabl',
            PostingProfile: 'V-PP',
            PaymentId: 'PAY789',
            PaymentReference: 'REF789',
            TransactionText: 'Vendor payment',
            Invoice: 'INV-0003',
            Voucher: '',
          },
        },
      ],
      'USMF',
      'out',
    );

    const body = result[0].customLineApiBody;
    expect(body).toHaveProperty('OffsetAccountTypeStr', 'RCash');
    expect(body).toHaveProperty('PAYMENTMETHODNAME', 'RCash');
    expect(body).toHaveProperty('MARKEDINVOICE', 'INV-0003');
  });

  it('rejects invalid TaxGroup values', () => {
    const handler = buildHandler();

    const missing = (handler as any).validateLine({
      dataAreaId: 'USMF',
      LineNumber: 1,
      cashDirection: 'out',
      customLineApiBody: {
        AccountNum: 'VEND001',
        accountTypeStr: 'Vendor',
        company: 'USMF',
        currency: 'EGP',
        DEFAULTDIMENSIONDISPLAYVALUE: 'a|b|c',
        offsetDEFAULTDIMENSIONDISPLAYVALUE: 'a|b|c',
        offsetAccountDisplayValue: 'BANK001',
        OffsetAccountTypeStr: 'Bank',
        OffsetCompany: 'USMF',
        transDate: '2026-04-21T00:00:00',
        PostingProfile: 'V-PP',
        TaxGroup: 'TG1',
      },
    });

    expect(missing).toContain(
      'customLineApiBody.TaxGroup (must be Taxable or Non-Taxabl)',
    );
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
            SalesTaxGroup: 'Non-Taxabl',
            PostingProfile: 'V-PP',
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
