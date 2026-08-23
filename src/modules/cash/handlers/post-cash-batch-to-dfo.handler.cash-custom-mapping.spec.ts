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
    expect(body).toHaveProperty('PostingProfile', 'Custom-PP');
    expect(body).toHaveProperty('transDate', '2026-04-21T00:00:00');
    expect(body).toHaveProperty('DocumentNum', 'DOC-1001');
    expect(body).toHaveProperty('DocumentDate', '2026-04-20T00:00:00');
    expect(body).toHaveProperty('ExchangeRate');
    expect(body).toHaveProperty('EXCHANGERATE');
    expect(body).not.toHaveProperty('MARKEDINVOICE');
    expect(body.MarkedLines).toEqual([
      {
        InvoiceNumber: 'INV-0001',
        OperationNumber: '',
        DocumentNumber: 'DOC-1001',
        HasWithHoldingLine: false,
      },
    ]);
    expect(body.ReportingCurrencyExchRate).toBe(100);
    expect(body.ReportingExchangeRate).toBe(100);
    expect(body.REPORTINGEXCHANGERATE).toBe(100);
    expect(body.ExchRateSecond).toBe(100);
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
            SafeType: 'Spec',
            TransactionText: 'Vendor payment',
            Invoice: 'INV-0002',
            MarkedInvoice: 'INV-0002',
            MarkedLines: [
              {
                InvoiceNumber: 'INV-0002',
                OperationNumber: 'OP-1',
                DocumentNumber: '',
                HasWithHoldingLine: false,
              },
            ],
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
    expect(body).toHaveProperty('MarkedLines', [
      {
        InvoiceNumber: 'INV-0002',
        OperationNumber: 'OP-1',
        DocumentNumber: '',
        HasWithHoldingLine: false,
      },
    ]);
    expect(body).toHaveProperty('TaxGroup', 'Non-Taxabl');
    expect(body).toHaveProperty('debitAmount', 1000);
    expect(body).toHaveProperty('creditAmount', 0);
    expect(body).toHaveProperty('transDate', '2026-04-21T00:00:00');
    expect(body).toHaveProperty('DocumentNum', 'DOC-2002');
    expect(body).toHaveProperty('DocumentDate', '2026-04-19T00:00:00');
    expect(body).toHaveProperty('ExchangeRate');
    expect(body).toHaveProperty('EXCHANGERATE');
    expect(body).toHaveProperty('ReportingExchangeRate');
    expect(body).toHaveProperty('ReportingCurrencyExchRate');
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
            MarkedLines: [
              {
                InvoiceNumber: 'INV-0003',
                OperationNumber: 'OP-2',
                DocumentNumber: '',
                HasWithHoldingLine: false,
              },
            ],
            Voucher: '',
          },
        },
      ],
      'USMF',
      'out',
    );

    const body = result[0].customLineApiBody;
    expect(body).toHaveProperty('OffsetAccountTypeStr', 'RCash');
    expect(body).toHaveProperty('offsetAccountDisplayValue', 'PSD EG');
    expect(body).toHaveProperty('PAYMENTMETHODNAME', '51');
    expect(body).toHaveProperty('MarkedLines', [
      {
        InvoiceNumber: 'INV-0003',
        OperationNumber: 'OP-2',
        DocumentNumber: '',
        HasWithHoldingLine: false,
      },
    ]);
  });

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
    'treats an offsetless GL %s line as single-sided and defaults its blank tax group',
    (sourceAccountType, expectedAccountType) => {
      const handler = buildHandler();
      const route = new CashJournalRoutingService().resolve({
        safeType: 'Custody Issue',
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

  it('keeps offset fields mandatory for an AP vendor-payment route', () => {
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
            TransactionText: 'Invalid offsetless AP line',
          },
        },
      ],
      'm-p',
      'out',
      route,
    );

    expect((handler as any).validateLine(result[0], route)).toEqual([
      'customLineApiBody.offsetDEFAULTDIMENSIONDISPLAYVALUE',
    ]);
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
        transDate: '2026-01-01T00:00:00',
        TaxGroup: 'Non-Taxabl',
      },
    };

    expect((handler as any).validateLine(line)).toEqual([]);
    expect(
      (handler as any).validateLine({ ...line, cashDirection: 'in' }),
    ).toContain('customLineApiBody.OffsetAccountTypeStr');
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
            FinTagDisplayValue: finTag,
            OffsetFinTagDisplayValue: finTag,
            SalesTaxGroup: 'Non-Taxabl',
            PostingProfile: 'V-PP',
            PaymentReference: 'ALEXHO US-2 - Freight',
            TransactionText: 'Vendor Payment - Freight Jan 2026 (Cash)',
            MarkedInvoice: '2025001410',
            MarkedLines: [
              {
                InvoiceNumber: '2025001410',
                OperationNumber: 'OP-A',
                DocumentNumber: '',
                HasWithHoldingLine: false,
              },
            ],
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
            FinTagDisplayValue: finTag,
            OffsetFinTagDisplayValue: finTag,
            SalesTaxGroup: 'Non-Taxabl',
            PostingProfile: 'V-PP',
            PaymentReference: 'ALEXHO US-2 - Freight',
            TransactionText: 'Vendor Payment - Freight Jan 2026 (Cash)',
            MarkedInvoice: '2025011319',
            MarkedLines: [
              {
                InvoiceNumber: '2025011319',
                OperationNumber: 'OP-B',
                DocumentNumber: '',
                HasWithHoldingLine: false,
              },
            ],
          },
        },
      ],
      'm-p',
      'out',
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
      expect(body).toHaveProperty('ExchangeRate');
      expect(body).toHaveProperty('EXCHANGERATE');
    }
  });

  it('maps successfully posted Custody Issue group 466672 without invoice settlement', () => {
    const handler = buildHandler();
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
            FinTagDisplayValue: finTag,
            OffsetFinTagDisplayValue: finTag,
            SalesTaxGroup: 'Non-Taxabl',
            PostingProfile: 'V-PP',
            PaymentId: '1',
            PaymentReference: 'PSD EG-1 - Freight',
            TransactionText: 'Vendor Payment - Freight January 2026 (Cash)',
            MarkedInvoice: '',
          },
        },
      ],
      'm-p',
      'out',
    );

    expect(result).toHaveLength(1);
    const body = result[0].customLineApiBody;
    expect(body).toHaveProperty('AccountNum', '5019');
    expect(body).toHaveProperty('debitAmount', 5000);
    expect(body).toHaveProperty('MarkedLines', []);
    expect(body).toHaveProperty('FinTagStr', finTag);
    expect(body).toHaveProperty('OFFSETFINTAGDISPLAYVALUE', finTag);
    expect(body).toHaveProperty('DocumentNum', '15925');
    expect(body).toHaveProperty('DocumentDate', '2026-01-01T00:00:00');
    expect(body).toHaveProperty('ExchangeRate');
    expect(body).toHaveProperty('EXCHANGERATE');
  });

  it('preserves explicitly unmarked outbound text without mapper-side rewriting', () => {
    const handler = new PostCashBatchToDFOHandler({} as any, {} as any);

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
            Description: 'Vendor Payment - Freight Jan 2026',
            TransactionText: 'Vendor Payment - Freight Jan 2026',
            Invoice: 'INV-RAW-ORIGINAL',
            MarkedInvoice: '',
          },
        },
      ],
      'm-p',
      'out',
    );

    expect(result).toHaveLength(1);
    const body = result[0].customLineApiBody;
    expect(body.MarkedLines).toEqual([]);
    expect(body.TRANSACTIONTEXT).toBe('Vendor Payment - Freight Jan 2026');
    expect(body.OFFSETTRANSACTIONTEXT).toBe('');
    expect(body.PAYMENTNOTES).toBe('Vendor Payment - Freight Jan 2026');
  });

  it('labels a historical Vendor Payment with empty MarkedLines using its invoice', () => {
    const handler = new PostCashBatchToDFOHandler({} as any, {} as any);

    const result = (handler as any).mapLines(
      [
        {
          data: {
            LineNumber: 2,
            SafeType: 'Vendor Payment',
            AccountDisplayValue: 'VEND-002',
            OffsetAccountDisplayValue: 'BANK-002',
            AccountType: 'Vend',
            OffsetAccountType: 'Bank',
            DebitAmount: 500,
            CreditAmount: 0,
            CurrencyCode: 'EGP',
            TransDate: '2026-01-15',
            VoucherType: 'Cash',
            Invoice: 'INV-HISTORICAL-002',
            MarkedInvoice: '',
            MarkedLines: [],
          },
        },
      ],
      'm-p',
      'out',
    );

    const body = result[0].customLineApiBody;
    expect(body.MarkedLines).toEqual([]);
    expect(body.PAYMENTNOTES).toBe('Unmarked - INV-HISTORICAL-002');
    expect(body.TRANSACTIONTEXT).toBe('Unmarked - INV-HISTORICAL-002');
  });

  it('preserves the strict settlement identity on a 223304 withholding companion', () => {
    const handler = buildHandler();

    const result = (handler as any).mapLines(
      [
        {
          data: {
            dataAreaId: 'm-p',
            JournalBatchNumber: 'Mesco-000015000',
            LineNumber: 5,
            AccountType: 'Vend',
            AccountDisplayValue: 'Tr-000031',
            OffsetAccountType: 'Ledger',
            OffsetAccountDisplayValue: '223304|1201|012|001',
            DebitAmount: 367.26,
            CreditAmount: 0,
            CurrencyCode: 'EGP',
            TransDate: '2026-01-18',
            VoucherType: 'Cash',
            SafeType: 'Vendor Payment',
            Description: '396',
            TransactionText: '396',
            Invoice: '396',
            MarkedInvoice: '396',
            Document: '16476',
            MarkedLines: [
              {
                InvoiceNumber: '396',
                OperationNumber: 'O26-EXP-OC-206',
                DocumentNumber: '16476',
                HasWithHoldingLine: true,
              },
            ],
          },
        },
      ],
      'm-p',
      'out',
      new CashJournalRoutingService().resolve({
        safeType: 'Vendor Payment',
        targetProcessor: 'Freight',
      }),
    );

    const body = result[0].customLineApiBody;
    expect(body.MarkedLines).toEqual([
      {
        InvoiceNumber: '396',
        OperationNumber: 'O26-EXP-OC-206',
        DocumentNumber: '16476',
        HasWithHoldingLine: true,
      },
    ]);
    expect(body.PAYMENTNOTES).toBe('396');
    expect(body.TRANSACTIONTEXT).toBe('396');
    expect(body.debitAmount).toBe(367.26);
    expect(body.OffsetAccountDisplayValue).toBeUndefined();
    expect(body.offsetAccountDisplayValue).toContain('223304');
  });

  it('does not trim the exact D365 invoice identity in MarkedLines', () => {
    const handler = buildHandler();
    const result = (handler as any).mapLines(
      [
        {
          data: {
            dataAreaId: 'm-p',
            LineNumber: 1,
            AccountType: 'Vend',
            AccountDisplayValue: 'Ag-000194',
            OffsetAccountType: 'Bank',
            OffsetAccountDisplayValue: 'BANK-1',
            DebitAmount: 6076.44,
            CreditAmount: 0,
            CurrencyCode: 'EUR',
            TransDate: '2026-02-28',
            VoucherType: 'Transfer',
            SafeType: 'Vendor Payment',
            MarkedInvoice: 'GDY_FV000005995',
            MarkedLines: [
              {
                InvoiceNumber: ' GDY_FV000005995',
                OperationNumber: 'O25-IMP-OC-12561',
                DocumentNumber: '17728',
                HasWithHoldingLine: false,
              },
            ],
          },
        },
      ],
      'm-p',
      'out',
      new CashJournalRoutingService().resolve({
        safeType: 'Vendor Payment',
        targetProcessor: 'Freight',
      }),
    );

    expect(result[0].customLineApiBody.MarkedLines[0].InvoiceNumber).toBe(
      ' GDY_FV000005995',
    );
  });

  it('rejects a vendor-payment line that has MarkedInvoice without MarkedLines', () => {
    const handler = buildHandler();

    expect(() =>
      (handler as any).mapLines(
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
              PostingProfile: 'V-PP',
              SafeType: 'Vendor Payment',
              TransactionText: 'Vendor payment',
              Invoice: 'INV-0002',
              MarkedInvoice: 'INV-0002',
            },
          },
        ],
        'USMF',
        'out',
        new CashJournalRoutingService().resolve({
          safeType: 'Vendor Payment',
          targetProcessor: 'Freight',
        }),
      ),
    ).toThrow('has MarkedInvoice "INV-0002" but no MarkedLines');
  });
});
