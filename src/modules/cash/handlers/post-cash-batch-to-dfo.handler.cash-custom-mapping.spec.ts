import { PostCashBatchToDFOHandler } from './post-cash-batch-to-dfo.handler';

import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';

describe('PostCashBatchToDFOHandler - cash custom line mapping', () => {
  const buildHandler = () =>
    new PostCashBatchToDFOHandler(
      {} as any,
      {} as any,
      new CashJournalRoutingService(),
    );

  it('rejects an invalid formatted batch before creating a D365 posting job', async () => {
    const dataBatchService = {
      getByIdAsync: jest.fn().mockResolvedValue({
        _id: '6a65e873576185ca307a8c52',
        company: 'm-p',
        entryProcessorType: 22,
        status: 1,
        errorCount: 1,
      }),
    };
    const queueService = { addJob: jest.fn() };
    const handler = new PostCashBatchToDFOHandler(
      dataBatchService as any,
      queueService as any,
    );

    await expect(
      handler.execute({ batchId: '6a65e873576185ca307a8c52' } as any),
    ).rejects.toThrow(
      'Batch contains 1 validation error(s) and cannot be posted to D365FO',
    );
    expect(queueService.addJob).not.toHaveBeenCalled();
  });

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
            Document: 'DOC-1001',
            DocumentDate: '2026-04-20T00:00:00.000Z',
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
            ReportingCurrencyExchRate: 1,
            PostingProfile: 'Custom-PP',
            PaymentId: 'PAY123',
            PaymentReference: 'REF123',
            SafeType: 'Spec',
            TransactionText: 'Customer payment',
            MarkedInvoice: 'INV-0001',
            MarkedLines: [
              {
                InvoiceNumber: 'INV-0001',
                OperationNumber: 'OP-0001',
                DocumentNumber: '',
                HasWithHoldingLine: false,
              },
            ],
            Voucher: '',
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
    expect(body).toHaveProperty('ITEMWITHHOLDINGTAXGROUP', '');
    expect(body).toHaveProperty('PostingProfile', 'Custom-PP');
    expect(body).toHaveProperty('transDate', '2026-04-21T00:00:00');
    expect(body).toHaveProperty('DocumentNum', 'DOC-1001');
    expect(body).toHaveProperty('DocumentDate', '2026-04-20T00:00:00');
    expect(body).not.toHaveProperty('ExchangeRate');
    expect(body).not.toHaveProperty('EXCHANGERATE');
    expect(body).not.toHaveProperty('ExchRate');
    expect(body.ReportingCurrencyExchRate).toBe(100);
    expect(body.ReportingExchangeRate).toBe(100);
    expect(body.REPORTINGEXCHANGERATE).toBe(100);
    expect(body.ExchRateSecond).toBe(100);
    expect(body.MarkedLines).toEqual([
      {
        InvoiceNumber: 'INV-0001',
        OperationNumber: 'OP-0001',
        DocumentNumber: '',
        HasWithHoldingLine: false,
      },
    ]);
    expect(body.MARKEDINVOICE).toBe('INV-0001');
  });

  it('maps cash-out dyn line into custom API body (Vendor endpoint semantics)', () => {
    const handler = buildHandler();
    const route = new CashJournalRoutingService().resolve({
      safeType: 'Vendor Payment',
      targetProcessor: 'Freight',
    });

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
            Document: 'DOC-2002',
            DocumentDate: '2026-04-19T00:00:00.000Z',
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
            SafeType: 'Vendor Payment',
            TransactionText: 'Vendor payment',
            Invoice: ' INV-0002 ',
            MarkedInvoice: ' INV-0002 ',
            Voucher: '',
          },
        },
      ],
      'USMF',
      'out',
      route,
    );

    expect(result[0].customLineApiBody).toBeDefined();
    const body = result[0].customLineApiBody;

    expect(body).toHaveProperty('journalNum', '');
    expect(body).toHaveProperty('AccountNum', 'VEND001');
    expect(body).toHaveProperty('accountTypeStr', 'Vendor');
    expect(body).toHaveProperty('PostingProfile', 'V-PP');
    expect(body).toHaveProperty('MarkedLines', [
      {
        InvoiceNumber: ' INV-0002 ',
        OperationNumber: 'TAG1',
        DocumentNumber: '',
        HasWithHoldingLine: false,
      },
    ]);
    expect(body).toHaveProperty('TaxGroup', 'Non-Taxabl');
    expect(body).toHaveProperty('ITEMWITHHOLDINGTAXGROUP', '');
    expect(body).toHaveProperty('IsWithholdingTaxCalculate', 'No');
    expect(body).toHaveProperty('ISWITHHOLDINGTAXCALCULATE', 'No');
    expect(body).toHaveProperty('debitAmount', 1000);
    expect(body).toHaveProperty('creditAmount', 0);
    expect(body).toHaveProperty('transDate', '2026-04-21T00:00:00');
    expect(body).toHaveProperty('DocumentNum', 'DOC-2002');
    expect(body).toHaveProperty('DocumentDate', '2026-04-19T00:00:00');
    expect(body).toHaveProperty('ExchangeRate', 1);
    expect(body).not.toHaveProperty('EXCHANGERATE');
    expect(body).not.toHaveProperty('ExchRate');
    expect(body).toHaveProperty('ReportingExchangeRate');
    expect(body).toHaveProperty('ReportingCurrencyExchRate');
    expect(body).toHaveProperty('PostingProfile', 'V-PP');
  });

  it('maps Petty cash / rcash account types to RCash (case-insensitive)', () => {
    const handler = buildHandler();
    const route = new CashJournalRoutingService().resolve({
      safeType: 'Vendor Payment',
      targetProcessor: 'Freight',
    });

    const result = (handler as any).mapLines(
      [
        {
          data: {
            dataAreaId: 'USMF',
            JournalBatchNumber: 'JN000123',
            LineNumber: 1,
            AccountType: 'Vend',
            AccountDisplayValue: '5019',
            OffsetAccountDisplayValue: 'PSD EG',
            OffsetAccountType: 'Petty cash',
            OffsetCompany: 'USMF',
            DefaultDimensionsForAccountDisplayValue: 'BU-001|CC-002|Dept-003',
            DefaultDimensionsForOffsetAccountDisplayValue:
              'BU-001|CC-002|Dept-004',
            TransactionDate: '2026-04-21T00:00:00.000Z',
            ExchangeRate: 1,
            CreditAmount: 0,
            DebitAmount: 5000,
            CurrencyCode: 'EGP',
            VoucherType: 'cash',
            SalesTaxGroup: 'Non-Taxabl',
            PostingProfile: 'V-PP',
            PaymentId: 'PAY789',
            PaymentMethodName: '51',
            PaymentReference: 'REF789',
            TransactionText: 'Vendor payment',
            Invoice: 'INV-0003',
            MarkedInvoice: 'INV-0003',
            SafeType: 'Vendor Payment',
            Voucher: '',
          },
        },
      ],
      'USMF',
      'out',
      route,
    );

    const body = result[0].customLineApiBody;
    expect(body).toHaveProperty('OffsetAccountTypeStr', 'RCash');
    expect(body).toHaveProperty('offsetAccountDisplayValue', 'PSD EG');
    expect(body).toHaveProperty('PAYMENTMETHODNAME', '51');
    expect(body).toHaveProperty('MarkedLines', [
      {
        InvoiceNumber: 'INV-0003',
        OperationNumber: '',
        DocumentNumber: '',
        HasWithHoldingLine: false,
      },
    ]);
  });

  it.each([
    ['Petty cash', 'RCash'],
    ['RCash', 'RCash'],
    ['Bank', 'Bank'],
    ['Ledger', 'Ledger'],
  ])(
    'clears an inherited posting profile for a primary %s account',
    (sourceAccountType, expectedAccountType) => {
      const handler = buildHandler();
      const route = new CashJournalRoutingService().resolve({
        safeType: 'Custody Issue',
        targetProcessor: 'Freight',
      });

      const [mapped] = (handler as any).mapLines(
        [
          {
            data: {
              AccountType: sourceAccountType,
              AccountDisplayValue: 'PSD EG',
              TransactionDate: '2026-01-01',
              CreditAmount: 100,
              DebitAmount: 0,
              CurrencyCode: 'EGP',
              SafeType: 'Custody Issue',
              PostingProfile: 'V-PP',
            },
          },
        ],
        'm-p',
        'out',
        route,
      );

      expect(mapped.customLineApiBody).toMatchObject({
        AccountNum: 'PSD EG',
        accountTypeStr: expectedAccountType,
        PostingProfile: '',
      });
    },
  );

  it.each([
    ['Vend', 'Vendor', 'V-PP'],
    ['Cust', 'Cust', 'Cust-PP'],
  ])(
    'defaults a primary %s account to its subledger posting profile',
    (sourceAccountType, expectedAccountType, expectedProfile) => {
      const handler = buildHandler();
      const [mapped] = (handler as any).mapLines(
        [
          {
            data: {
              AccountType: sourceAccountType,
              AccountDisplayValue: 'ACCOUNT-001',
              TransactionDate: '2026-01-01',
              CreditAmount: 100,
              DebitAmount: 0,
              CurrencyCode: 'EGP',
            },
          },
        ],
        'm-p',
        'out',
      );

      expect(mapped.customLineApiBody).toMatchObject({
        accountTypeStr: expectedAccountType,
        PostingProfile: expectedProfile,
      });
    },
  );

  it('keeps PAYMENTMETHODNAME empty for Petty cash when Excel has no payment method', () => {
    const handler = buildHandler();

    const result = (handler as any).mapLines(
      [
        {
          data: {
            dataAreaId: 'USMF',
            LineNumber: 1,
            AccountType: 'Vend',
            AccountDisplayValue: 'VEND001',
            OffsetAccountDisplayValue: 'CASH001',
            OffsetAccountType: 'Petty cash',
            TransactionDate: '2026-04-21',
            DebitAmount: 1000,
            CurrencyCode: 'EGP',
            SalesTaxGroup: 'Non-Taxabl',
            PostingProfile: 'V-PP',
            PaymentMethodName: '',
          },
        },
      ],
      'USMF',
      'out',
    );

    const body = result[0].customLineApiBody;
    expect(body).toHaveProperty('OffsetAccountTypeStr', 'RCash');
    expect(body).toHaveProperty('PAYMENTMETHODNAME', '');
  });

  it('keeps Bank offsetAccountDisplayValue as account id (not dim string)', () => {
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
            OffsetAccountDisplayValue: 'AAIB-EG-CA',
            OffsetAccountType: 'Bank',
            OffsetCompany: 'USMF',
            DefaultDimensionDisplayValue:
              '1301|013|001|005|101001213|101001213|5019|5019|16545|3042|5013|Collect|||IMPORT||||',
            OffsetDefaultDimensionDisplayValue:
              '1301|013|001|005|101001213|101001213|5019|5019|16545|3042|5013|Collect|||IMPORT||||',
            TransactionDate: '2026-04-21T00:00:00.000Z',
            ExchangeRate: 1,
            CreditAmount: 0,
            DebitAmount: 5000,
            CurrencyCode: 'EGP',
            VoucherType: 'cash',
            SalesTaxGroup: 'Non-Taxabl',
            PostingProfile: 'V-PP',
            PaymentId: 'PAY001',
            PaymentReference: 'PSD EG-1 - Freight',
            TransactionText: 'Vendor payment',
            Voucher: '',
          },
        },
      ],
      'USMF',
      'out',
    );

    const body = result[0].customLineApiBody;
    expect(body).toHaveProperty('offsetAccountDisplayValue', 'AAIB-EG-CA');
    expect(body).toHaveProperty(
      'DEFAULTDIMENSIONDISPLAYVALUE',
      '1301|013|001|005|101001213|101001213|5019|5019|16545|3042|5013|Collect|||IMPORT||||',
    );
  });

  it('defaults blank Cash-In SalesTaxGroup to Non-Taxabl for custom FO body', () => {
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
            CurrencyCode: 'EGP',
            VoucherType: 'Cash',
            SalesTaxGroup: '',
            ItemSalesTaxGroup: '',
            PostingProfile: 'Cust-PP',
            PaymentId: 'PAY-IN-1',
            PaymentReference: 'REF-IN-1',
            TransactionText: 'Customer collection',
            MarkedInvoice: '000008898/OR-TR',
            Voucher: '',
          },
        },
      ],
      'USMF',
      'in',
    );

    expect(result[0].customLineApiBody.TaxGroup).toBe('Non-Taxabl');
    expect((handler as any).validateLine(result[0])).not.toContain(
      'customLineApiBody.TaxGroup (must be Taxable or Non-Taxabl)',
    );
  });

  it('omits every offset field for a standalone Cash-In source line', () => {
    const handler = buildHandler();

    const result = (handler as any).mapLines(
      [
        {
          data: {
            AccountType: 'Cust',
            AccountDisplayValue: 'CUST001',
            DefaultDimensionDisplayValue: 'BU|CC',
            TransactionDate: '2026-04-21T00:00:00.000Z',
            CreditAmount: 1000,
            DebitAmount: 0,
            CurrencyCode: 'EGP',
            SafeType: 'Customer Collection',
            SalesTaxGroup: '',
            PostingProfile: 'Cust-PP',
            MarkedInvoice: '000008898/OR-TR',
            MarkedLines: [
              {
                InvoiceNumber: '000008898/OR-TR',
                OperationNumber: '',
                DocumentNumber: '',
                HasWithHoldingLine: false,
              },
            ],
          },
        },
      ],
      'm-p',
      'in',
    );

    const body = result[0].customLineApiBody;
    expect(
      Object.keys(body).filter((key) => key.toLowerCase().startsWith('offset')),
    ).toEqual([]);
    expect(body.MarkedLines).toEqual([
      {
        InvoiceNumber: '000008898/OR-TR',
        OperationNumber: '',
        DocumentNumber: '',
        HasWithHoldingLine: false,
      },
    ]);
    expect((handler as any).validateLine(result[0])).toEqual([]);
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
        transDate: '2026-04-21',
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
    expect(result[0].customLineApiBody).toHaveProperty(
      'offsetAccountDisplayValue',
      ledgerDisplayValue,
    );
  });

  it('omits every offset field for a Cash Out main-account-only ledger line', () => {
    const handler = buildHandler();
    const route = new CashJournalRoutingService().resolve({
      safeType: 'Direct',
    });
    const ledgerDisplayValue =
      '223404|2101|021|002|007|101000084|101000084|Tr-000052|Tr-000052|745|12021|12016|Payable|13||DOMESTIC||||';

    const result = (handler as any).mapLines(
      [
        {
          data: {
            AccountType: 'Ledger',
            AccountDisplayValue: ledgerDisplayValue,
            TransactionDate: '2026-04-21T00:00:00.000Z',
            CreditAmount: 0,
            DebitAmount: 1000,
            CurrencyCode: 'EGP',
            SafeType: 'Direct',
            SalesTaxGroup: 'Non-Taxabl',
            TransactionText: 'Main account only',
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    const body = result[0].customLineApiBody;
    expect(body.AccountNum).toBe(ledgerDisplayValue);
    expect(body.DEFAULTDIMENSIONDISPLAYVALUE).toBe(
      '|2101|021|002|007|101000084|101000084|Tr-000052|Tr-000052|745|12021|12016|Payable|13||DOMESTIC||||',
    );
    expect(
      Object.keys(body).filter((key) => key.toLowerCase().startsWith('offset')),
    ).toEqual([]);
    expect((handler as any).validateLine(result[0], route)).toEqual([]);
  });

  it.each([
    ['Vend', 'Vendor'],
    ['Petty cash', 'RCash'],
    ['Bank', 'Bank'],
    ['Cust', 'Cust'],
  ])(
    'treats an offsetless Custody Issue %s line as single-sided and defaults its blank tax group',
    (sourceAccountType, expectedAccountType) => {
      const handler = buildHandler();
      const route = new CashJournalRoutingService().resolve({
        safeType: 'Custody Issue',
        targetProcessor: 'Freight',
      });

      const result = (handler as any).mapLines(
        [
          {
            data: {
              AccountType: sourceAccountType,
              AccountDisplayValue: 'ACCOUNT-001',
              DefaultDimensionDisplayValue: 'BU|CC',
              TransactionDate: '2026-01-01T00:00:00.000Z',
              CreditAmount: 0,
              DebitAmount: 100,
              CurrencyCode: 'EGP',
              SafeType: 'Custody Issue',
              SalesTaxGroup: '',
              TransactionText: 'Single-sided GL line',
            },
          },
        ],
        'm-p',
        'out',
        route,
      );

      const body = result[0].customLineApiBody;
      expect(body.accountTypeStr).toBe(expectedAccountType);
      expect(body.TaxGroup).toBe('Non-Taxabl');
      expect(
        Object.keys(body).filter((key) =>
          key.toLowerCase().startsWith('offset'),
        ),
      ).toEqual([]);
      expect((handler as any).validateLine(result[0], route)).toEqual([]);
    },
  );

  it('omits offset fields for an AP Vendor Payment main-account-only line', () => {
    const handler = buildHandler();
    const route = new CashJournalRoutingService().resolve({
      safeType: 'Vendor Payment',
      targetProcessor: 'Freight',
    });
    const result = (handler as any).mapLines(
      [
        {
          data: {
            AccountType: 'Vend',
            AccountDisplayValue: 'VEND001',
            DefaultDimensionDisplayValue: 'BU|CC',
            TransactionDate: '2026-01-01T00:00:00.000Z',
            CreditAmount: 0,
            DebitAmount: 100,
            CurrencyCode: 'EGP',
            SafeType: 'Vendor Payment',
            SalesTaxGroup: '',
            TransactionText: 'Main-account-only AP line',
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    const body = result[0].customLineApiBody;
    expect(body.AccountNum).toBe('VEND001');
    expect(
      Object.keys(body).filter((key) => key.toLowerCase().startsWith('offset')),
    ).toEqual([]);
    expect((handler as any).validateLine(result[0], route)).toEqual([]);
  });

  it('omits every offset field for Vendor Payment Ledger main-account-only lines', () => {
    const handler = buildHandler();
    const route = new CashJournalRoutingService().resolve({
      safeType: 'Vendor Payment',
      targetProcessor: 'Freight',
    });
    const ledgerDisplayValue =
      '223404|2101|021|002|007|101000084|101000084|Tr-000052|Tr-000052|745|12021|12016|Payable|13||DOMESTIC||||';

    const result = (handler as any).mapLines(
      [
        {
          data: {
            AccountType: 'Ledger',
            AccountDisplayValue: ledgerDisplayValue,
            TransactionDate: '2026-04-21T00:00:00.000Z',
            CreditAmount: 0,
            DebitAmount: 1000,
            CurrencyCode: 'EGP',
            SafeType: 'Vendor Payment',
            SalesTaxGroup: 'Non-Taxabl',
            TransactionText: 'Main account only ledger under Vendor Payment',
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    const body = result[0].customLineApiBody;
    expect(body.accountTypeStr).toBe('Ledger');
    expect(body.AccountNum).toBe(ledgerDisplayValue);
    expect(body.VendorGroup).toBe('');
    expect(
      Object.keys(body).filter((key) => key.toLowerCase().startsWith('offset')),
    ).toEqual([]);
    expect((handler as any).validateLine(result[0], route)).toEqual([]);
  });

  it('accepts the documented blank offset account type for Cash Out only', () => {
    const handler = buildHandler();
    const line = {
      dataAreaId: 'm-p',
      LineNumber: 1,
      cashDirection: 'out',
      customLineApiBody: {
        AccountNum: '5019',
        accountTypeStr: 'Vendor',
        company: 'm-p',
        currency: 'EGP',
        DEFAULTDIMENSIONDISPLAYVALUE: 'account-dimensions',
        offsetDEFAULTDIMENSIONDISPLAYVALUE: 'offset-dimensions',
        offsetAccountDisplayValue: 'PSD EG',
        OffsetAccountTypeStr: '',
        OffsetCompany: 'm-p',
        transDate: '2026-01-01',
        TaxGroup: 'Non-Taxabl',
      },
    };

    expect((handler as any).validateLine(line)).toEqual([]);
    // Cash-In is always main-account-only (no offset counterpart), so partial
    // offset fields must not become validation failures for cash-in lines.
    expect(
      (handler as any).validateLine({ ...line, cashDirection: 'in' }),
    ).toEqual([]);
  });

  it('omits all offset fields for Cash-In mapped lines', () => {
    const handler = buildHandler();
    const route = new CashJournalRoutingService().resolve({
      safeType: 'Customer Collection',
    });

    const result = (handler as any).mapLines(
      [
        {
          data: {
            AccountType: 'Cust',
            AccountDisplayValue: '101000001',
            OffsetAccountType: 'Bank',
            OffsetAccountDisplayValue: 'BANK-001',
            OffsetCompany: 'm-p',
            OffsetDefaultDimensionDisplayValue: 'BANK-001',
            TransactionDate: '2026-01-15T00:00:00.000Z',
            CreditAmount: 100,
            DebitAmount: 0,
            CurrencyCode: 'EGP',
            SafeType: 'Customer Collection',
            DefaultDimensionDisplayValue:
              '|1301|013|001|001||||||||Payable|||IMPORT||||',
          },
        },
      ],
      'm-p',
      'in',
      route,
    );

    const body = result[0].customLineApiBody;
    expect(body.OffsetAccountTypeStr).toBeUndefined();
    expect(body.offsetAccountDisplayValue).toBeUndefined();
    expect(body.offsetDEFAULTDIMENSIONDISPLAYVALUE).toBeUndefined();
    expect(body.OffsetCompany).toBeUndefined();
  });

  it('keeps offset fields for a standard Cash Out ledger line', () => {
    const handler = buildHandler();
    const route = new CashJournalRoutingService().resolve({
      safeType: 'Direct',
    });
    const ledgerDisplayValue =
      '223404|2101|021|002|007|101000084|101000084|Tr-000052|Tr-000052|745|12021|12016|Payable|13||DOMESTIC||||';

    const result = (handler as any).mapLines(
      [
        {
          data: {
            AccountType: 'Ledger',
            AccountDisplayValue: ledgerDisplayValue,
            OffsetAccountType: 'Bank',
            OffsetAccountDisplayValue: 'AAIB-EG-CA',
            OffsetCompany: 'm-p',
            OffsetDefaultDimensionDisplayValue: 'AAIB-EG-CA',
            OffsetFinTagDisplayValue: 'OP-2078',
            OffsetTransactionText: 'Bank offset',
            TransactionDate: '2026-04-21T00:00:00.000Z',
            CreditAmount: 0,
            DebitAmount: 1000,
            CurrencyCode: 'EGP',
            SafeType: 'Direct',
            SalesTaxGroup: 'Non-Taxabl',
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    expect(result[0].customLineApiBody).toEqual(
      expect.objectContaining({
        OffsetAccountTypeStr: 'Bank',
        OffsetCompany: 'm-p',
        offsetAccountDisplayValue: 'AAIB-EG-CA',
        offsetDEFAULTDIMENSIONDISPLAYVALUE: 'AAIB-EG-CA',
        OFFSETFINTAGDISPLAYVALUE: 'OP-2078',
        OFFSETTRANSACTIONTEXT: 'Bank offset',
      }),
    );
  });

  it('maps real Safe Out group 466698 with tags and without exchange rates', () => {
    const handler = buildHandler();
    const route = new CashJournalRoutingService().resolve({
      safeType: 'Vendor Payment',
      targetProcessor: 'Freight',
    });
    const finTag =
      'O25-IMP-OC-12581|ME_Q-20251239362-IMP-FCL|Sl-000020|Sl-000020|SOKCB25001058||||||INMUN1 Mundra|EGSOK Sokhna Port||||||31/12/2025|';
    const defaultDimension =
      '|1201|012|001|001|101006533|101006533|Sl-000020|Sl-000020|16544|3076|3040|Payable|||IMPORT||||';
    const offsetDimension =
      '|1201|012|001|001|101006533|101006533|Sl-000020|Sl-000020||3076|3040|Payable|||IMPORT||||';

    const result = (handler as any).mapLines(
      [
        {
          data: {
            dataAreaId: 'm-p',
            JournalBatchNumber: '1',
            LineNumber: 1,
            AccountType: 'Vend',
            AccountDisplayValue: 'Sl-000020',
            OffsetAccountType: 'Petty cash',
            OffsetAccountDisplayValue: 'ALEXHO US',
            OffsetCompany: 'm-p',
            DefaultDimensionsForAccountDisplayValue: defaultDimension,
            DefaultDimensionsForOffsetAccountDisplayValue: offsetDimension,
            TransactionDate: '2026-01-01T00:00:00.000Z',
            Document: '15936',
            DocumentDate: '2026-01-01T00:00:00.000Z',
            ExchangeRate: 4765,
            DebitAmount: 300,
            CreditAmount: 0,
            CurrencyCode: 'USD',
            VoucherType: 'Cash',
            SafeType: 'Vendor Payment',
            FinTagDisplayValue: finTag,
            OffsetFinTagDisplayValue: finTag,
            SalesTaxGroup: 'Non-Taxabl',
            PostingProfile: 'V-PP',
            PaymentReference: 'ALEXHO US-2 - Freight',
            TransactionText: 'Vendor Payment - Freight Jan 2026 (Cash)',
            MarkedInvoice: '2025001410',
          },
        },
        {
          data: {
            dataAreaId: 'm-p',
            JournalBatchNumber: '1',
            LineNumber: 2,
            AccountType: 'Vend',
            AccountDisplayValue: 'Sl-000020',
            OffsetAccountType: 'Petty cash',
            OffsetAccountDisplayValue: 'ALEXHO US',
            OffsetCompany: 'm-p',
            DefaultDimensionsForAccountDisplayValue: defaultDimension,
            DefaultDimensionsForOffsetAccountDisplayValue: offsetDimension,
            TransactionDate: '2026-01-01T00:00:00.000Z',
            Document: '15936',
            DocumentDate: '2026-01-01T00:00:00.000Z',
            ExchangeRate: 4765,
            DebitAmount: 255,
            CreditAmount: 0,
            CurrencyCode: 'USD',
            VoucherType: 'Cash',
            SafeType: 'Vendor Payment',
            FinTagDisplayValue: finTag,
            OffsetFinTagDisplayValue: finTag,
            SalesTaxGroup: 'Non-Taxabl',
            PostingProfile: 'V-PP',
            PaymentReference: 'ALEXHO US-2 - Freight',
            TransactionText: 'Vendor Payment - Freight Jan 2026 (Cash)',
            MarkedInvoice: '2025011319',
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    expect(result).toHaveLength(2);
    expect(
      result.map(
        (line: any) => line.customLineApiBody.MarkedLines?.[0]?.InvoiceNumber,
      ),
    ).toEqual(['2025001410', '2025011319']);
    expect(
      result.map((line: any) => line.customLineApiBody.debitAmount),
    ).toEqual([300, 255]);

    for (const line of result) {
      const body = line.customLineApiBody;
      expect(body).toHaveProperty('FinTagStr', finTag);
      expect(body).toHaveProperty('OFFSETFINTAGDISPLAYVALUE', finTag);
      expect(body).toHaveProperty('DocumentNum', '15936');
      expect(body).toHaveProperty('DocumentDate', '2026-01-01T00:00:00');
      expect(body).toHaveProperty('ExchangeRate', 4765);
      expect(body).not.toHaveProperty('EXCHANGERATE');
      expect(body).not.toHaveProperty('ExchRate');
    }
  });

  it('does not synthesize MarkedLines for Custody Issue (marking is Vendor Payment only)', () => {
    const handler = buildHandler();
    const routing = new CashJournalRoutingService();
    const route = routing.resolve({
      safeType: 'Custody Issue',
      targetProcessor: 'Freight',
    });
    const finTag =
      'O25-IMP-OC-11585||Sl-000009|Ag-000010|261633796|||||EGY CROWN|CNSHA Shanghai|EGPSD Port Said West|||30/12/2025||02/12/2025|31/12/2025|';

    const result = (handler as any).mapLines(
      [
        {
          data: {
            dataAreaId: 'm-p',
            JournalBatchNumber: 'Mesco-000000001',
            LineNumber: 1,
            AccountType: 'Vend',
            AccountDisplayValue: '5019',
            OffsetAccountType: 'Petty cash',
            OffsetAccountDisplayValue: 'PSD EG',
            OffsetCompany: 'm-p',
            DefaultDimensionsForAccountDisplayValue:
              '1301|013|001|005|101001213|101001213|5019|5019|16545|3042|5013|Collect|||IMPORT||||',
            DefaultDimensionsForOffsetAccountDisplayValue:
              '1301|013|001|005|101001213|101001213|5019|5019|16545|3042|5013|Collect|||IMPORT||||',
            TransactionDate: '2026-01-01T00:00:00.000Z',
            Document: '15925',
            DocumentDate: '2026-01-01T00:00:00.000Z',
            ExchangeRate: 100,
            DebitAmount: 5000,
            CreditAmount: 0,
            CurrencyCode: 'EGP',
            VoucherType: 'Cash',
            SafeType: 'Custody Issue',
            VendorGroup: 'Custody',
            FinTagDisplayValue: finTag,
            OffsetFinTagDisplayValue: finTag,
            SalesTaxGroup: 'Non-Taxabl',
            PostingProfile: 'V-PP',
            PaymentId: '1',
            PaymentReference: 'PSD EG-1 - Freight',
            TransactionText: 'Custody Issue - Freight January 2026 (Cash)',
            MarkedInvoice: '',
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    expect(result).toHaveLength(1);
    const body = result[0].customLineApiBody;
    expect(body).toHaveProperty('AccountNum', '5019');
    expect(body).toHaveProperty('debitAmount', 5000);
    expect(body).toHaveProperty('VendorGroup', 'Custody');
    expect(body.MarkedLines).toEqual([]);
    expect(body.TRANSACTIONTEXT).not.toContain('unmarked');
    expect(body).toHaveProperty('DocumentNum', '15925');
  });

  it('maps Vendor Payment custody marks into MarkedLines with DocumentNumber and OperationNumber', () => {
    const handler = buildHandler();
    const routing = new CashJournalRoutingService();
    const route = routing.resolve({
      safeType: 'Vendor Payment',
      targetProcessor: 'Freight',
    });
    const finTag =
      'O25-IMP-OC-11585||Sl-000009|Ag-000010|261633796|||||EGY CROWN|CNSHA Shanghai|EGPSD Port Said West|||30/12/2025||02/12/2025|31/12/2025|';

    const result = (handler as any).mapLines(
      [
        {
          data: {
            AccountType: 'Vend',
            AccountDisplayValue: '5019',
            OffsetAccountType: 'Bank',
            OffsetAccountDisplayValue: 'BANK-1',
            DebitAmount: 5000,
            CreditAmount: 0,
            CurrencyCode: 'EGP',
            Document: '15925',
            VendorGroup: 'Custody',
            SettlementTargetType: 'CustodyLedger',
            SafeType: 'Vendor Payment',
            FinTagDisplayValue: finTag,
            MarkedLines: [
              {
                InvoiceNumber: '',
                OperationNumber: 'O25-IMP-OC-11585',
                DocumentNumber: '15925',
                HasWithHoldingLine: false,
              },
            ],
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    expect(result[0].customLineApiBody.MarkedLines).toEqual([
      {
        InvoiceNumber: '',
        OperationNumber: 'O25-IMP-OC-11585',
        DocumentNumber: '15925',
        HasWithHoldingLine: false,
      },
    ]);
  });

  it('maps Custody Settlement custody MarkedLines and FO dates without inventing marks', () => {
    const handler = buildHandler();
    const routing = new CashJournalRoutingService();
    const route = routing.resolve({
      safeType: 'Custody Settlement',
      targetProcessor: 'Freight',
    });
    const finTag =
      'O26-IMP-OC-1|\u200FME_Q-20251239129-IMP-FCL\u200E|\u200FSl-000010\u200E|';

    const result = (handler as any).mapLines(
      [
        {
          data: {
            AccountType: 'Vend',
            AccountDisplayValue: '3071',
            TransactionDate: '2026-01-25T00:00:00.000Z',
            Document: '16383',
            DocumentDate: '2026-01-14T00:00:00.000Z',
            ExchRate: 4765,
            CreditAmount: 29,
            DebitAmount: 0,
            CurrencyCode: 'USD',
            VendorGroup: 'Custody',
            SettlementTargetType: 'CustodyLedger',
            SafeType: 'Custody Settlement',
            FinTagDisplayValue: finTag,
            OffsetFinTagDisplayValue: finTag,
            SalesTaxGroup: 'Non-Taxabl',
            PostingProfile: 'V-PP',
            ReportingCurrencyExchRate: 1,
            MarkedLines: [
              {
                InvoiceNumber: '',
                OperationNumber: 'O26-IMP-OC-1',
                DocumentNumber: '16383',
                HasWithHoldingLine: false,
              },
            ],
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    const body = result[0].customLineApiBody;
    expect(body.transDate).toBe('2026-01-25T00:00:00');
    expect(body.DocumentDate).toBe('2026-01-14T00:00:00');
    expect(body).toHaveProperty('ExchangeRate', 4765);
    expect(body).not.toHaveProperty('EXCHANGERATE');
    expect(body.ReportingExchangeRate).toBe(100);
    expect(body.VendorGroup).toBe('Custody');
    expect(body.FinTagStr).toBe(
      'O26-IMP-OC-1|ME_Q-20251239129-IMP-FCL|Sl-000010|',
    );
    expect(body.MarkedLines).toEqual([
      {
        InvoiceNumber: '',
        OperationNumber: 'O26-IMP-OC-1',
        DocumentNumber: '16383',
        HasWithHoldingLine: false,
      },
    ]);
  });

  it('synthesizes Custody Settlement MarkedLines when formatting left them empty', () => {
    const handler = buildHandler();
    const routing = new CashJournalRoutingService();
    const route = routing.resolve({
      safeType: 'Custody Settlement',
      targetProcessor: 'Freight',
    });
    const finTag = 'O25-IMP-OC-12140|TAG|Sl-000007|';

    const result = (handler as any).mapLines(
      [
        {
          data: {
            AccountType: 'Vend',
            AccountDisplayValue: '3071',
            DebitAmount: 0,
            CreditAmount: 100,
            CurrencyCode: 'EGP',
            Document: '15895',
            Invoice: '',
            VendorGroup: 'Custody',
            SafeType: 'Custody Settlement',
            FinTagDisplayValue: finTag,
            PaymentId: '510442',
            SourceIds: ['510442'],
            MarkedInvoice: '',
            MarkedLines: [],
            TransactionText: 'Custody Settlement - Freight January 2026 (Cash)',
          },
        },
        {
          data: {
            AccountType: 'Vend',
            AccountDisplayValue: 'Sl-000007',
            DebitAmount: 100,
            CreditAmount: 0,
            CurrencyCode: 'EGP',
            Document: '15895',
            Invoice: 'TMT13',
            VendorGroup: 'Trade',
            SettlementTargetType: 'VendorInvoice',
            SafeType: 'Custody Settlement',
            FinTagDisplayValue: finTag,
            PaymentId: '510442',
            SourceIds: ['510442'],
            MarkedInvoice: 'TMT13',
            MarkedLines: [],
            TransactionText: 'Custody Settlement - Freight January 2026 (Cash)',
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    expect(result[0].customLineApiBody.MarkedLines).toEqual([
      {
        InvoiceNumber: '',
        OperationNumber: 'O25-IMP-OC-12140',
        DocumentNumber: '15895',
        HasWithHoldingLine: false,
      },
    ]);
    expect(result[1].customLineApiBody.MarkedLines).toEqual([
      {
        InvoiceNumber: 'TMT13',
        OperationNumber: 'O25-IMP-OC-12140',
        DocumentNumber: '',
        HasWithHoldingLine: false,
      },
    ]);
  });

  it('keeps the Custody Settlement primary mark when UniqueId has 223304', () => {
    const handler = buildHandler();
    const routing = new CashJournalRoutingService();
    const route = routing.resolve({
      safeType: 'Custody Settlement',
      targetProcessor: 'Freight',
    });

    const result = (handler as any).mapLines(
      [
        {
          data: {
            AccountType: 'Vend',
            AccountDisplayValue: 'VEND-001',
            DebitAmount: 1000,
            CreditAmount: 0,
            CurrencyCode: 'EGP',
            Document: 'DOC-1',
            Invoice: 'INV-1',
            VendorGroup: 'Trade',
            SafeType: 'Custody Settlement',
            FinTagDisplayValue: 'OP-1|TAG',
            PaymentId: '480003',
            SourceIds: ['480003'],
            MarkedInvoice: 'INV-1',
            MarkedLines: [],
            IsWithholdingCalculationEnabled: 'Yes',
            TransactionText: 'Custody Settlement - Freight January 2026 (Cash)',
          },
        },
        {
          data: {
            AccountType: 'Ledger',
            AccountDisplayValue: '223304|1101|011|001',
            DebitAmount: 0,
            CreditAmount: 50,
            CurrencyCode: 'EGP',
            SafeType: 'Custody Settlement',
            PaymentId: '480003',
            SourceIds: ['480003'],
            TransactionText: 'Custody Settlement - Freight January 2026 (Cash)',
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    expect(result[0].customLineApiBody.MarkedLines).toEqual([
      expect.objectContaining({
        InvoiceNumber: 'INV-1',
        HasWithHoldingLine: true,
      }),
    ]);
    expect(result[0].customLineApiBody.TRANSACTIONTEXT).not.toContain(
      'Unmarked',
    );
    expect(result[1].customLineApiBody.accountTypeStr).toBe('Vendor');
    expect(result[1].customLineApiBody.AccountNum).toBe('VEND-001');
    expect(result[1].customLineApiBody.offsetAccountDisplayValue).toBe(
      '223304|1101|011|001',
    );
    expect(result[1].customLineApiBody.OffsetAccountTypeStr).toBe('Ledger');
    expect(result[1].customLineApiBody.debitAmount).toBe(50);
    expect(result[1].customLineApiBody.creditAmount).toBe(0);
    expect(result[1].customLineApiBody.IsWithholdingTaxCalculate).toBe('No');
    expect(result[1].customLineApiBody.MarkedLines).toEqual([
      expect.objectContaining({
        InvoiceNumber: 'INV-1',
        HasWithHoldingLine: true,
      }),
    ]);
  });

  it('maps Custody Settlement standard-vendor MarkedLines with InvoiceNumber only', () => {
    const handler = buildHandler();
    const routing = new CashJournalRoutingService();
    const route = routing.resolve({
      safeType: 'Custody Settlement',
      targetProcessor: 'Freight',
    });

    const result = (handler as any).mapLines(
      [
        {
          data: {
            AccountType: 'Vend',
            AccountDisplayValue: 'Sl-000007',
            DebitAmount: 1000,
            CreditAmount: 0,
            CurrencyCode: 'EGP',
            Document: '15895',
            VendorGroup: 'Trade',
            SettlementTargetType: 'VendorInvoice',
            SafeType: 'Custody Settlement',
            FinTagDisplayValue: 'O25-IMP-OC-12140|TAG',
            MarkedInvoice: 'TMT13',
            MarkedLines: [
              {
                InvoiceNumber: 'TMT13',
                OperationNumber: 'O25-IMP-OC-12140',
                DocumentNumber: '',
                HasWithHoldingLine: false,
              },
            ],
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    expect(result[0].customLineApiBody.MarkedLines).toEqual([
      {
        InvoiceNumber: 'TMT13',
        OperationNumber: 'O25-IMP-OC-12140',
        DocumentNumber: '',
        HasWithHoldingLine: false,
      },
    ]);
  });

  it('maps Vendor Payment WHT and non-WHT MarkedLines into the FO VendPaym body', () => {
    const handler = buildHandler();
    const route = new CashJournalRoutingService().resolve({
      safeType: 'Vendor Payment',
      targetProcessor: 'Freight',
    });

    const result = (handler as any).mapLines(
      [
        {
          data: {
            PaymentId: 'G1',
            AccountType: 'Vend',
            AccountDisplayValue: 'Su-000068',
            OffsetAccountType: 'Ledger',
            OffsetAccountDisplayValue: '223201|1101|011|001',
            DebitAmount: 888,
            CreditAmount: 0,
            CurrencyCode: 'EGP',
            FinTagDisplayValue: 'OP-3829|TAG',
            Description: 'Vendor Payment - Freight January 2026 (Transfer)',
            TransactionText: 'Vendor Payment - Freight January 2026 (Transfer)',
            SafeType: 'Vendor Payment',
            MarkedInvoice: '3829',
            Invoice: '3829',
            SettlementTargetType: 'VendorInvoice',
            MarkedLines: [
              {
                InvoiceNumber: '3829',
                OperationNumber: 'OP-3829',
                DocumentNumber: '',
                HasWithHoldingLine: false,
              },
            ],
            IsWithholdingCalculationEnabled: 'Yes',
          },
        },
        {
          data: {
            PaymentId: 'G1',
            AccountType: 'Vend',
            AccountDisplayValue: 'Su-000068',
            OffsetAccountType: 'Ledger',
            OffsetAccountDisplayValue: '223304|1101|011|001',
            DebitAmount: 24,
            CreditAmount: 0,
            CurrencyCode: 'EGP',
            FinTagDisplayValue: 'OP-3829|TAG',
            Description: 'Vendor Payment - Freight January 2026 (Transfer)',
            TransactionText: 'Vendor Payment - Freight January 2026 (Transfer)',
            SafeType: 'Vendor Payment',
            MarkedInvoice: '',
            Invoice: '3829',
            Document: '18369',
            SettlementTargetType: 'VendorInvoice',
            MarkedLines: [],
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    expect(result).toHaveLength(2);
    // Both portions carry the invoice mark. The companion also preserves its
    // top-level document number from the source row.
    expect(result[0].customLineApiBody.MarkedLines).toEqual([
      expect.objectContaining({
        InvoiceNumber: '3829',
        HasWithHoldingLine: true,
      }),
    ]);
    expect(result[0].customLineApiBody.TRANSACTIONTEXT).not.toMatch(
      /unmarked/i,
    );
    expect(result[1].customLineApiBody.MarkedLines).toEqual([
      {
        InvoiceNumber: '3829',
        OperationNumber: 'OP-3829',
        DocumentNumber: '',
        HasWithHoldingLine: true,
      },
    ]);
    expect(result[1].customLineApiBody.DocumentNum).toBe('18369');
    expect(result[1].customLineApiBody.TRANSACTIONTEXT).not.toMatch(
      /unmarked/i,
    );
    expect(result[1].customLineApiBody.offsetAccountDisplayValue).toContain(
      '223304',
    );
  });

  it('preserves empty MARKEDINVOICE and appends " - Unmarked" for Vendor Payment when MarkedInvoice was cleared', () => {
    const handler = buildHandler();
    const routing = new CashJournalRoutingService();
    const route = routing.resolve({
      safeType: 'Vendor Payment',
      targetProcessor: 'Freight',
    });

    const result = (handler as any).mapLines(
      [
        {
          data: {
            LineNumber: 1,
            AccountDisplayValue: 'VEND-001',
            OffsetAccountDisplayValue: 'BANK-001',
            AccountType: 'Vend',
            OffsetAccountType: 'Bank',
            DebitAmount: 500,
            CreditAmount: 0,
            CurrencyCode: 'EGP',
            TransDate: '2026-01-15',
            VoucherType: 'Cash',
            SafeType: 'Vendor Payment',
            Description: 'Vendor Payment - Freight Jan 2026',
            TransactionText: 'Vendor Payment - Freight Jan 2026',
            Invoice: 'INV-RAW-ORIGINAL',
            MarkedInvoice: '',
            MarkedLines: [],
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    expect(result).toHaveLength(1);
    const body = result[0].customLineApiBody;
    expect(body.MarkedLines).toEqual([]);
    expect(body.TRANSACTIONTEXT).toBe(
      'Vendor Payment - Freight Jan 2026 - Unmarked',
    );
    expect(body.OFFSETTRANSACTIONTEXT).toBe('Unmarked');
    expect(body.PAYMENTNOTES).toBe(
      'Vendor Payment - Freight Jan 2026 - Unmarked',
    );
  });

  it('maps Custody Settlement lines with offset and sends MarkedLines on both lines and withholding', () => {
    const handler = buildHandler();
    const routing = new CashJournalRoutingService();
    const route = routing.resolve({
      safeType: 'Custody Settlement',
      targetProcessor: 'Freight',
    });

    const result = (handler as any).mapLines(
      [
        {
          data: {
            PaymentId: 'CS-GROUP-1',
            SourceIds: ['CS-GROUP-1'],
            AccountType: 'Vend',
            AccountDisplayValue: 'Su-000072',
            OffsetAccountType: 'Bank',
            OffsetAccountDisplayValue: 'BANK-001',
            DebitAmount: 14000,
            CreditAmount: 0,
            CurrencyCode: 'EGP',
            TransDate: '2026-01-15',
            VoucherType: 'Cash',
            SafeType: 'Custody Settlement',
            VendorGroup: 'Trade',
            SettlementTargetType: 'VendorInvoice',
            Invoice: 'INV-CS-001',
            MarkedInvoice: 'INV-CS-001',
            FinTagDisplayValue: 'OP-CS-1|TAG',
            OffsetFinTagDisplayValue: 'OP-CS-1|TAG',
            Description: 'Custody Settlement - Freight Jan 2026',
            TransactionText: 'Custody Settlement - Freight Jan 2026',
            OffsetTransactionText: 'Custody Settlement - Freight Jan 2026',
            MarkedLines: [
              {
                InvoiceNumber: 'INV-CS-001',
                OperationNumber: 'OP-CS-1',
                DocumentNumber: '',
                HasWithHoldingLine: true,
              },
            ],
            IsWithholdingCalculationEnabled: 'Yes',
          },
        },
        {
          data: {
            PaymentId: 'CS-GROUP-1',
            SourceIds: ['CS-GROUP-1'],
            AccountType: 'Vend',
            AccountDisplayValue: '4080',
            OffsetAccountType: 'Petty Cash',
            OffsetAccountDisplayValue: 'Airport EG',
            DebitAmount: 0,
            CreditAmount: 10000,
            CurrencyCode: 'EGP',
            TransDate: '2026-01-15',
            VoucherType: 'Cash',
            SafeType: 'Custody Settlement',
            VendorGroup: 'Custody',
            SettlementTargetType: 'CustodyLedger',
            Document: '16046',
            FinTagDisplayValue: 'OP-CS-1|TAG',
            OffsetFinTagDisplayValue: 'OP-CS-1|TAG',
            Description: 'Custody Settlement - Freight Jan 2026',
            TransactionText: 'Custody Settlement - Freight Jan 2026',
            OffsetTransactionText: 'Custody Settlement - Freight Jan 2026',
            MarkedLines: [
              {
                InvoiceNumber: '',
                OperationNumber: 'OP-CS-1',
                DocumentNumber: '16046',
                HasWithHoldingLine: false,
              },
            ],
          },
        },
        {
          data: {
            PaymentId: 'CS-GROUP-1',
            SourceIds: ['CS-GROUP-1'],
            AccountType: 'Ledger',
            AccountDisplayValue: '223304|1101|011|001',
            DebitAmount: 0,
            CreditAmount: 50,
            CurrencyCode: 'EGP',
            TransDate: '2026-01-15',
            VoucherType: 'Cash',
            SafeType: 'Custody Settlement',
            Description: 'Custody Settlement - Freight Jan 2026',
            TransactionText: 'Custody Settlement - Freight Jan 2026',
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    expect(result).toHaveLength(3);

    // Line 1: Trade vendor with offset
    const line1 = result[0].customLineApiBody;
    expect(line1.AccountNum).toBe('Su-000072');
    expect(line1.accountTypeStr).toBe('Vendor');
    expect(line1.offsetAccountDisplayValue).toBe('BANK-001');
    expect(line1.OffsetAccountTypeStr).toBe('Bank');
    expect(line1.MarkedLines).toEqual([
      {
        InvoiceNumber: 'INV-CS-001',
        OperationNumber: 'OP-CS-1',
        DocumentNumber: '',
        HasWithHoldingLine: true,
      },
    ]);

    // Line 2: Custody vendor with offset
    const line2 = result[1].customLineApiBody;
    expect(line2.AccountNum).toBe('4080');
    expect(line2.accountTypeStr).toBe('Vendor');
    expect(line2.offsetAccountDisplayValue).toBe('Airport EG');
    expect(line2.OffsetAccountTypeStr).toBe('RCash');
    expect(line2.MarkedLines).toEqual([
      {
        InvoiceNumber: '',
        OperationNumber: 'OP-CS-1',
        DocumentNumber: '16046',
        HasWithHoldingLine: false,
      },
    ]);

    // Line 3: stored Ledger 223304 is rewritten to Vendor→223304 so FO
    // never calls TaxWithhold::construct(Ledger) on retry.
    const line3 = result[2].customLineApiBody;
    expect(line3.AccountNum).toBe('Su-000072');
    expect(line3.accountTypeStr).toBe('Vendor');
    expect(line3.offsetAccountDisplayValue).toBe('223304|1101|011|001');
    expect(line3.OffsetAccountTypeStr).toBe('Ledger');
    expect(line3.debitAmount).toBe(50);
    expect(line3.creditAmount).toBe(0);
    expect(line3.IsWithholdingTaxCalculate).toBe('No');
    expect(line3.MarkedLines).toEqual([
      {
        InvoiceNumber: 'INV-CS-001',
        OperationNumber: 'OP-CS-1',
        DocumentNumber: '',
        HasWithHoldingLine: true,
      },
    ]);
  });

  it('rewrites a stored Ledger 223304 cash-out line to Vendor offset on post', () => {
    const handler = buildHandler();
    const routing = new CashJournalRoutingService();
    const route = routing.resolve({
      safeType: 'Vendor Payment',
      targetProcessor: 'Freight',
    });

    const result = (handler as any).mapLines(
      [
        {
          data: {
            PaymentId: '469001',
            SourceIds: ['469001'],
            AccountType: 'Vend',
            AccountDisplayValue: 'Tr-000031',
            OffsetAccountType: 'Petty Cash',
            OffsetAccountDisplayValue: 'PSD EG',
            DebitAmount: 13440.47,
            CreditAmount: 0,
            CurrencyCode: 'EGP',
            Document: '18369',
            Invoice: '120',
            MarkedInvoice: '120',
            VendorGroup: 'Trade',
            SafeType: 'Vendor Payment',
            FinTagDisplayValue: 'O26-EXP-OC-1759|TAG',
            SettlementTargetType: 'VendorInvoice',
            MarkedLines: [
              {
                InvoiceNumber: '120',
                OperationNumber: 'O26-EXP-OC-1759',
                DocumentNumber: '',
                HasWithHoldingLine: true,
              },
            ],
          },
        },
        {
          data: {
            PaymentId: '469001',
            SourceIds: ['469001'],
            AccountType: 'Ledger',
            AccountDisplayValue: '223304|1201|012|001',
            DebitAmount: 0,
            CreditAmount: 358.08,
            CurrencyCode: 'EGP',
            Document: '18369',
            SafeType: 'Vendor Payment',
            FinTagDisplayValue: 'O26-EXP-OC-1759|TAG',
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    expect(result).toHaveLength(2);
    expect(result[0].customLineApiBody.AccountNum).toBe('Tr-000031');
    expect(result[0].customLineApiBody.accountTypeStr).toBe('Vendor');
    expect(result[1].customLineApiBody.AccountNum).toBe('Tr-000031');
    expect(result[1].customLineApiBody.accountTypeStr).toBe('Vendor');
    expect(result[1].customLineApiBody.offsetAccountDisplayValue).toBe(
      '223304|1201|012|001',
    );
    expect(result[1].customLineApiBody.OffsetAccountTypeStr).toBe('Ledger');
    expect(result[1].customLineApiBody.debitAmount).toBe(358.08);
    expect(result[1].customLineApiBody.creditAmount).toBe(0);
    expect(result[1].customLineApiBody.IsWithholdingTaxCalculate).toBe('No');
    expect(result[1].customLineApiBody.ISWITHHOLDINGTAXCALCULATE).toBe('No');
    expect(result[1].customLineApiBody.TaxWithholdCalculate).toBe('No');
    expect(result[1].customLineApiBody.IsWithholdingCalculationEnabled).toBe('No');
    expect(result[1].customLineApiBody.ITEMWITHHOLDINGTAXGROUP).toBe('');
    expect(result[1].customLineApiBody.MarkedLines).toEqual([
      {
        InvoiceNumber: '120',
        OperationNumber: 'O26-EXP-OC-1759',
        DocumentNumber: '',
        HasWithHoldingLine: true,
      },
    ]);
  });

  it('rewrites stored Ledger 223301, 223302, and 223305 withholding lines to Vendor offsets on post', () => {
    const handler = buildHandler();
    const routing = new CashJournalRoutingService();
    const route = routing.resolve({
      safeType: 'Vendor Payment',
      targetProcessor: 'Freight',
    });

    for (const whtAccount of ['223301|1201|012|001', '223302|1201|012|001', '223305|1201|012|001']) {
      const result = (handler as any).mapLines(
        [
          {
            data: {
              PaymentId: '469002',
              SourceIds: ['469002'],
              AccountType: 'Vend',
              AccountDisplayValue: 'Tr-000031',
              DebitAmount: 5000,
              CreditAmount: 0,
              CurrencyCode: 'EGP',
              Document: '18370',
              Invoice: '121',
              MarkedInvoice: '121',
              VendorGroup: 'Trade',
              SafeType: 'Vendor Payment',
              FinTagDisplayValue: 'O26-EXP-OC-1760|TAG',
              SettlementTargetType: 'VendorInvoice',
              MarkedLines: [
                {
                  InvoiceNumber: '121',
                  OperationNumber: 'O26-EXP-OC-1760',
                  DocumentNumber: '',
                  HasWithHoldingLine: true,
                },
              ],
            },
          },
          {
            data: {
              PaymentId: '469002',
              SourceIds: ['469002'],
              AccountType: 'Ledger',
              AccountDisplayValue: whtAccount,
              DebitAmount: 0,
              CreditAmount: 150,
              CurrencyCode: 'EGP',
              Document: '18370',
              SafeType: 'Vendor Payment',
              FinTagDisplayValue: 'O26-EXP-OC-1760|TAG',
            },
          },
        ],
        'm-p',
        'out',
        route,
      );

      expect(result).toHaveLength(2);
      expect(result[1].customLineApiBody.AccountNum).toBe('Tr-000031');
      expect(result[1].customLineApiBody.accountTypeStr).toBe('Vendor');
      expect(result[1].customLineApiBody.offsetAccountDisplayValue).toBe(whtAccount);
      expect(result[1].customLineApiBody.OffsetAccountTypeStr).toBe('Ledger');
      expect(result[1].customLineApiBody.debitAmount).toBe(150);
      expect(result[1].customLineApiBody.creditAmount).toBe(0);
      expect(result[1].customLineApiBody.IsWithholdingTaxCalculate).toBe('No');
      expect(result[1].customLineApiBody.ISWITHHOLDINGTAXCALCULATE).toBe('No');
      expect(result[1].customLineApiBody.TaxWithholdCalculate).toBe('No');
      expect(result[1].customLineApiBody.IsWithholdingCalculationEnabled).toBe('No');
      expect(result[1].customLineApiBody.ITEMWITHHOLDINGTAXGROUP).toBe('');
    }
  });

  it('maps "led" to Ledger and "customer" to Cust account type', () => {
    const handler = buildHandler();
    expect((handler as any).mapEntryAccountTypeStrForCustom('led')).toBe('Ledger');
    expect((handler as any).mapEntryAccountTypeStrForCustom('customer')).toBe('Cust');
  });
});
