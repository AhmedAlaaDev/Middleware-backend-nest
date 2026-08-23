import { CustomerPaymentJournalService } from './customer-payment-journal.service';

describe('CustomerPaymentJournalService - cash custom line APIs', () => {
  function buildService() {
    const d365foClient = {
      post: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
      patch: jest.fn(),
    };

    const queryBuilder = {
      and: jest.fn(),
      eq: jest.fn(),
      or: jest.fn(),
      buildQuery: jest.fn(),
    };

    const retryService = {
      executeWithRetry: jest.fn((fn: any) => fn()),
      configureAxiosRetry: jest.fn(),
    };

    const dfoErrorExtractor = {
      extractMessage: jest.fn((e: unknown) => (e as any)?.message ?? String(e)),
      normalize: jest.fn(() => ({ isConcurrencyConflict: false })),
    };

    const vendorPaymentJournalService = {
      listLinesForHeader: jest.fn().mockResolvedValue([]),
      updateLineFinancialTags: jest.fn().mockResolvedValue(undefined),
      updateLineDescription: jest.fn().mockResolvedValue(undefined),
    };

    const vendorInvoiceJournalService = {
      verifyVendorPaymentJournalSettlements: jest.fn().mockResolvedValue([]),
    };

    const operationalLogs = {
      emit: jest.fn().mockResolvedValue(undefined),
    };

    const logPayloads = {
      captureExchange: jest.fn((request: unknown, response?: unknown) => ({
        ...(request === undefined
          ? {}
          : { request: { body: request, sizeBytes: 0, truncated: false } }),
        ...(response === undefined
          ? {}
          : { response: { body: response, sizeBytes: 0, truncated: false } }),
      })),
    };

    const configService = {
      get: jest.fn().mockReturnValue({ bulkHttpTimeout: 600_000 }),
    };

    const service = new CustomerPaymentJournalService(
      d365foClient as any,
      queryBuilder as any,
      retryService as any,
      dfoErrorExtractor as any,
      vendorPaymentJournalService as any,
      vendorInvoiceJournalService as any,
      operationalLogs as any,
      logPayloads as any,
      configService as any,
    );

    return {
      service,
      d365foClient,
      vendorPaymentJournalService,
      vendorInvoiceJournalService,
      operationalLogs,
      logPayloads,
    };
  }

  it('posts cash-in via addLedgerJournalTransCustPaym with journalNum (key casing)', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();

    jest
      .spyOn(service, 'listLinesForHeader')
      .mockResolvedValueOnce([] as Array<{ LineNumber: number }>);

    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! JN000123',
    });

    const lines: any[] = [
      {
        dataAreaId: 'USMF',
        LineNumber: 1,
        cashDirection: 'in',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'CUST001',
          accountTypeStr: 'Cust',
          BANKTRANSACTIONTYPE: 'Transfer',
          CENTRALBANKPURPOSECODE: '001',
          CENTRALBANKPURPOSETEXT: 'Payment',
          company: 'USMF',
          creditAmount: 1000,
          currency: 'USD',
          debitAmount: 0,
          DEFAULTDIMENSIONDISPLAYVALUE: 'BU-001|CC-002|Dept-003',
          offsetDEFAULTDIMENSIONDISPLAYVALUE: 'BU-001|CC-002|Dept-004',
          FinTagStr: 'TAG1',
          ISPREPAYMENT: 'No',
          ITEMWITHHOLDINGTAXGROUP: 'TAX1',
          MARKEDINVOICE: 'INV-0001',
          offsetAccountDisplayValue: 'BANK001',
          OffsetAccountTypeStr: 'Bank',
          OffsetCompany: 'USMF',
          OFFSETFINTAGDISPLAYVALUE: 'TAG2',
          OFFSETTRANSACTIONTEXT: 'Offset text',
          PAYMENTID: 'PAY123',
          PAYMENTMETHODNAME: 'Bank',
          PAYMENTNOTES: 'Customer payment',
          PAYMENTREFERENCE: 'REF123',
          PAYMENTSPECIFICATION: 'Spec',
          PostingProfile: 'PP1',
          TaxGroup: 'Taxable',
          TAXITEMGROUP: 'TIG1',
          transDate: '2026-04-21T00:00:00',
          DocumentNum: 'DOC-1001',
          DocumentDate: '2026-04-20T00:00:00',
          TRANSACTIONTEXT: 'Customer payment',
          Voucher: '',
          ExchRate: 100,
          EXCHANGERATE: 100,
          ExchangeRate: 100,
        },
      },
    ];

    await service.postCashInLinesForHeader('JN000123', lines, 20, 'USMF');

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    const [endpoint, body] = d365foClient.post.mock.calls[0];

    expect(endpoint).toContain('/addLedgerJournalTransCustPaym');
    expect(body._contract.Lines).toHaveLength(1);
    const postedLine = body._contract.Lines[0];
    expect(postedLine).toHaveProperty('journalNum', 'JN000123');
    expect(postedLine).toHaveProperty('AccountNum', 'CUST001');
    expect(postedLine).toHaveProperty('accountTypeStr', 'cust');
    expect(postedLine).toHaveProperty('transDate', '2026-04-21T00:00:00');
    expect(postedLine).toHaveProperty('DocumentNum', 'DOC-1001');
    expect(postedLine).toHaveProperty('DocumentDate', '2026-04-20T00:00:00');
    expect(postedLine).toHaveProperty('ExchangeRate');
    expect(postedLine).toHaveProperty('EXCHANGERATE');
    expect(
      vendorPaymentJournalService.updateLineFinancialTags,
    ).not.toHaveBeenCalled();
  });

  // Scenario 2: a single journal line still goes out inside Lines.
  it('posts one cash-out line through the bulk Lines contract without a Vendor Line update', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();

    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! JN000123',
    });

    const lines: any[] = [
      {
        dataAreaId: 'USMF',
        LineNumber: 1,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'VEND001',
          accountTypeStr: 'Vendor',
          BANKTRANSACTIONTYPE: 'Transfer',
          CENTRALBANKPURPOSECODE: '001',
          CENTRALBANKPURPOSETEXT: 'Payment',
          company: 'USMF',
          creditAmount: 0,
          currency: 'USD',
          debitAmount: 1000,
          DEFAULTDIMENSIONDISPLAYVALUE: 'BU-001|CC-002|Dept-003',
          offsetDEFAULTDIMENSIONDISPLAYVALUE: 'BU-001|CC-002|Dept-004',
          FinTagStr: 'TAG1',
          ISPREPAYMENT: 'No',
          ITEMWITHHOLDINGTAXGROUP: 'TAX1',
          MARKEDINVOICE: 'INV-0002',
          offsetAccountDisplayValue: 'BANK001',
          OffsetAccountTypeStr: 'Bank',
          OffsetCompany: 'USMF',
          OFFSETFINTAGDISPLAYVALUE: 'TAG2',
          OFFSETTRANSACTIONTEXT: 'Offset text',
          PAYMENTID: 'PAY456',
          PAYMENTMETHODNAME: 'Bank',
          PAYMENTNOTES: 'Vendor payment',
          PAYMENTREFERENCE: 'REF456',
          PAYMENTSPECIFICATION: 'Spec',
          PostingProfile: 'V-PP',
          TaxGroup: 'Non-Taxabl',
          TAXITEMGROUP: 'TIG1',
          transDate: '2026-04-21T00:00:00',
          DocumentNum: 'DOC-2002',
          DocumentDate: '2026-04-19T00:00:00',
          TRANSACTIONTEXT: 'Vendor payment',
          Voucher: '',
          ExchRate: 100,
          EXCHANGERATE: 100,
          ExchangeRate: 100,
        },
      },
    ];

    await service.postCashOutLinesForHeader('JN000123', lines, 20, 'USMF');

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    const [endpoint, body, options] = d365foClient.post.mock.calls[0];

    expect(endpoint).toContain('/addLedgerJournalTransVendPaym');
    expect(options).toEqual({ timeout: 600_000, retries: 0 });
    expect(body._contract.Lines).toHaveLength(1);
    const postedLine = body._contract.Lines[0];
    expect(postedLine).toHaveProperty('journalNum', 'JN000123');
    expect(postedLine).toHaveProperty('AccountNum', 'VEND001');
    expect(postedLine).toHaveProperty('accountTypeStr', 'vendor');
    expect(postedLine).toHaveProperty('FinTagStr', 'TAG1');
    expect(postedLine).toHaveProperty('OFFSETFINTAGDISPLAYVALUE', 'TAG2');
    expect(postedLine).toHaveProperty('OffsetAccountDisplayValue', 'BANK001');
    expect(postedLine).toHaveProperty(
      'OffsetDEFAULTDIMENSIONDISPLAYVALUE',
      'BU-001|CC-002|Dept-004',
    );
    expect(postedLine).toHaveProperty('DocumentNum', 'DOC-2002');
    expect(postedLine).toHaveProperty('DocumentDate', '2026-04-19T00:00:00');
    expect(postedLine).toHaveProperty('ExchangeRate', 100);
    // The offset keys are not repeated in the lowercase spelling, which would
    // collide with the PascalCase one the endpoint looks up.
    expect(postedLine).not.toHaveProperty('offsetAccountDisplayValue');
    expect(postedLine).not.toHaveProperty('offsetDEFAULTDIMENSIONDISPLAYVALUE');

    expect(vendorPaymentJournalService.listLinesForHeader).toHaveBeenCalledWith(
      'JN000123',
      'USMF',
    );
    expect(
      vendorPaymentJournalService.updateLineFinancialTags,
    ).not.toHaveBeenCalled();
  });

  it('removes only an exact duplicate settlement identity from a vendor credit', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! Mesco-000015023',
    });

    const markedLine = {
      InvoiceNumber: 'IA2025120309022485',
      OperationNumber: 'O25-IMP-OC-11343',
      DocumentNumber: '14846',
      HasWithHoldingLine: false,
    };
    const lines = [
      {
        dataAreaId: 'm-p',
        LineNumber: 14,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'Su-000019',
          accountTypeStr: 'Vendor',
          debitAmount: 8135.04,
          creditAmount: 0,
          PAYMENTNOTES: 'Supplier settlement',
          TRANSACTIONTEXT: 'Supplier settlement',
          MarkedLines: [{ ...markedLine }],
        },
      },
      {
        dataAreaId: 'm-p',
        LineNumber: 15,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: '3135',
          accountTypeStr: 'Vendor',
          debitAmount: 0,
          creditAmount: 8500,
          PAYMENTNOTES: 'Custody settlement',
          TRANSACTIONTEXT: 'Custody settlement',
          MarkedLines: [{ ...markedLine }],
        },
      },
    ];

    await service.postCashOutLinesForHeader(
      'Mesco-000015023',
      lines as any[],
      20,
      'm-p',
    );

    const postedLines = d365foClient.post.mock.calls[0][1]._contract.Lines;
    expect(postedLines[0].MarkedLines).toEqual([markedLine]);
    expect(postedLines[1].MarkedLines).toEqual([]);
  });

  it('keeps the invoice marked independently on the main payment and the 223304 companion', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! Mesco-000015002',
    });

    const invoiceMark = {
      InvoiceNumber: '008',
      OperationNumber: 'O26-EXP-OC-6',
      DocumentNumber: '16300',
      HasWithHoldingLine: true,
    };
    const secondInvoiceMark = {
      InvoiceNumber: '008a',
      OperationNumber: 'O26-EXP-OC-6',
      DocumentNumber: '16300',
      HasWithHoldingLine: false,
    };
    const lines = [
      {
        dataAreaId: 'm-p',
        LineNumber: 114,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'Su-000009',
          accountTypeStr: 'Vendor',
          offsetAccountDisplayValue: '223201|1501|015',
          debitAmount: 4079.7,
          creditAmount: 0,
          PAYMENTNOTES: '008',
          TRANSACTIONTEXT: '008',
          MarkedLines: [{ ...invoiceMark }, { ...secondInvoiceMark }],
        },
      },
      {
        dataAreaId: 'm-p',
        LineNumber: 115,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'Su-000009',
          accountTypeStr: 'Vendor',
          offsetAccountDisplayValue: '223304|1501|015',
          debitAmount: 150,
          creditAmount: 0,
          PAYMENTNOTES: '008',
          TRANSACTIONTEXT: '008',
          MarkedLines: [{ ...invoiceMark }],
        },
      },
    ];

    await service.postCashOutLinesForHeader(
      'Mesco-000015002',
      lines as any[],
      20,
      'm-p',
    );

    const postedLines = d365foClient.post.mock.calls[0][1]._contract.Lines;
    expect(postedLines).toHaveLength(2);
    expect(postedLines[0].MarkedLines).toEqual([
      invoiceMark,
      secondInvoiceMark,
    ]);
    expect(postedLines[1]).toEqual(
      expect.objectContaining({
        debitAmount: 150,
        MarkedLines: [invoiceMark],
        PAYMENTNOTES: '008',
        TRANSACTIONTEXT: '008',
      }),
    );
  });

  it('preserves a distinct withholding transaction mark on the 223304 companion', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! JN-WHT-UNIQUE',
    });

    const mainMark = {
      InvoiceNumber: 'INV-MAIN',
      OperationNumber: 'OP-1',
      DocumentNumber: 'DOC-1',
      HasWithHoldingLine: true,
    };
    const withholdingMark = {
      InvoiceNumber: 'INV-WHT',
      OperationNumber: 'OP-1',
      DocumentNumber: 'DOC-WHT',
      HasWithHoldingLine: false,
    };
    const lines = [
      {
        dataAreaId: 'm-p',
        LineNumber: 1,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'VEND-1',
          accountTypeStr: 'Vendor',
          offsetAccountDisplayValue: '223201|1001',
          debitAmount: 900,
          creditAmount: 0,
          MarkedLines: [mainMark],
        },
      },
      {
        dataAreaId: 'm-p',
        LineNumber: 2,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'VEND-1',
          accountTypeStr: 'Vendor',
          offsetAccountDisplayValue: '223304|1001',
          debitAmount: 100,
          creditAmount: 0,
          MarkedLines: [mainMark, withholdingMark],
        },
      },
    ];

    await service.postCashOutLinesForHeader(
      'JN-WHT-UNIQUE',
      lines as any[],
      20,
      'm-p',
    );

    const postedLines = d365foClient.post.mock.calls[0][1]._contract.Lines;
    expect(postedLines[0].MarkedLines).toEqual([mainMark]);
    expect(postedLines[1].MarkedLines).toEqual([mainMark, withholdingMark]);
  });

  // Scenario 1 + 3 + 4: all lines of the journal in one Lines array, with
  // per-line fields preserved and main-account-only offset keys empty.
  it('posts every line in a journal batch in one request and preserves line-specific fields', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! JN-BULK',
    });

    const lines: any[] = [
      {
        dataAreaId: 'm-p',
        LineNumber: 1,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'VEND001',
          accountTypeStr: 'Vendor',
          VendorGroup: 'Trade',
          MarkedLines: [
            {
              InvoiceNumber: 'INV-1',
              OperationNumber: 'OP-1',
              DocumentNumber: '',
              HasWithHoldingLine: true,
            },
          ],
          ReportingExchangeRate: 2.1,
          offsetAccountDisplayValue: 'BANK001',
          OffsetAccountTypeStr: 'Bank',
        },
      },
      {
        dataAreaId: 'm-p',
        LineNumber: 2,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: '223404|BU|CC',
          accountTypeStr: 'Ledger',
          DEFAULTDIMENSIONDISPLAYVALUE: 'BU|CC',
          FinTagStr: 'OP-2',
          ReportingExchangeRate: 2.2,
        },
      },
    ];

    const result = await service.postCashOutLinesForHeader(
      'JN-BULK',
      lines,
      1,
      'm-p',
    );

    expect(result).toEqual([
      { headerId: 'JN-BULK', lineNumber: 1 },
      { headerId: 'JN-BULK', lineNumber: 2 },
    ]);
    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    const contract = d365foClient.post.mock.calls[0][1]._contract;
    expect(contract.Lines).toHaveLength(2);
    expect(contract.Lines[0]).toEqual(
      expect.objectContaining({
        journalNum: 'JN-BULK',
        accountTypeStr: 'vendor',
        VendorGroup: 'Trade',
        ReportingExchangeRate: 2.1,
        MarkedLines: [
          expect.objectContaining({
            InvoiceNumber: 'INV-1',
            HasWithHoldingLine: true,
          }),
        ],
        OffsetAccountDisplayValue: 'BANK001',
        OffsetAccountTypeStr: 'Bank',
      }),
    );
    expect(contract.Lines[1]).toEqual(
      expect.objectContaining({
        journalNum: 'JN-BULK',
        accountTypeStr: 'ledger',
        // FO looks up VendorGroup on every line — empty for ledger.
        VendorGroup: '',
        ReportingExchangeRate: 2.2,
      }),
    );
    // Scenario 4: a main account-only line carries no offset account, while the
    // vendor line in the same request keeps its own. The keys stay on the line
    // because the endpoint looks each one up and throws when it is missing.
    for (const offsetKey of [
      'OffsetDEFAULTDIMENSIONDISPLAYVALUE',
      'OffsetAccountDisplayValue',
      'OffsetAccountTypeStr',
      'OffsetCompany',
      'OFFSETFINTAGDISPLAYVALUE',
      'OFFSETTRANSACTIONTEXT',
    ]) {
      expect(contract.Lines[1]).toHaveProperty(offsetKey, '');
    }
  });

  // Scenario 5 (large journals): submit through the cash-out endpoint in
  // requests of at most 100 Lines each.
  it('splits a journal batch into requests of at most 100 lines', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValue({
      StatusCode: 'Success',
      Message: 'Success! JN-250',
    });

    const lines: any[] = Array.from({ length: 250 }, (_, index) => ({
      dataAreaId: 'm-p',
      LineNumber: index + 1,
      cashDirection: 'out',
      customLineApiBody: {
        journalNum: '',
        AccountNum: `VEND${index + 1}`,
        accountTypeStr: 'Vendor',
        debitAmount: 100,
      },
    }));

    const result = await service.postCashOutLinesForHeader(
      'JN-250',
      lines,
      20,
      'm-p',
    );

    expect(result).toHaveLength(250);
    expect(d365foClient.post).toHaveBeenCalledTimes(3);
    const lineCounts = d365foClient.post.mock.calls.map(
      ([, body]: [string, any]) => body._contract.Lines.length,
    );
    expect(lineCounts).toEqual([100, 100, 50]);
    // Every line is sent exactly once, in order, and stays on its journal.
    const sentAccounts = d365foClient.post.mock.calls.flatMap(
      ([, body]: [string, any]) =>
        body._contract.Lines.map((line: any) => line.AccountNum),
    );
    expect(sentAccounts).toEqual(
      lines.map((line) => line.customLineApiBody.AccountNum),
    );
  });

  it('logs the complete bulk request body before sending it', async () => {
    const { service, d365foClient, operationalLogs } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! JN-LOG',
    });

    await service.postCashOutLinesForHeader(
      'JN-LOG',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 4,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: '5019',
            accountTypeStr: 'Vendor',
            debitAmount: 5000,
          },
        },
        {
          dataAreaId: 'm-p',
          LineNumber: 7,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: '223404|BU|CC',
            accountTypeStr: 'Ledger',
            creditAmount: 5000,
          },
        },
      ] as any[],
      20,
      'm-p',
    );

    const requestLog = operationalLogs.emit.mock.calls
      .map(([event]: [any]) => event)
      .find((event: any) => event.eventType === 'd365fo.cash-out.bulk-request');

    expect(requestLog.metadata).toEqual(
      expect.objectContaining({
        journalNum: 'JN-LOG',
        attempt: 'initial',
        lineCount: 2,
        lineNumbers: [4, 7],
      }),
    );
    // The logged body is exactly what was posted, with every line included.
    expect(requestLog.payload.request.body).toEqual(
      d365foClient.post.mock.calls[0][1],
    );
    expect(requestLog.payload.request.body._contract.Lines).toHaveLength(2);
  });

  it('fails a marked vendor payment when D365 accepts the bulk request but settlement cannot be verified', async () => {
    const {
      service,
      d365foClient,
      vendorInvoiceJournalService,
      operationalLogs,
    } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! JN-VERIFY',
    });
    vendorInvoiceJournalService.verifyVendorPaymentJournalSettlements.mockResolvedValue(
      [
        {
          lineNumber: 10,
          status: 'NOT_VERIFIED',
          reason:
            'No settled invoice rows matched vendor Tr-000031 and invoices 171',
          expectedVendorAccount: 'Tr-000031',
          expectedInvoices: ['171'],
          matchedInvoices: [],
          settlementAmount: 0,
          journalBatchNumber: 'JN-VERIFY',
          journalMarkedInvoice: '171',
          settleVoucher: '',
        },
      ],
    );

    await expect(
      service.postCashOutLinesForHeader(
        'JN-VERIFY',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 10,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'Tr-000031',
              accountTypeStr: 'Vendor',
              debitAmount: 16823.04,
              currency: 'EGP',
              MARKEDINVOICE: '171',
              MarkedLines: [
                {
                  InvoiceNumber: '171',
                  OperationNumber: 'O26-EXP-OC-2143',
                  DocumentNumber: '19307',
                  HasWithHoldingLine: true,
                },
              ],
            },
          },
        ] as any[],
        20,
        'm-p',
      ),
    ).rejects.toThrow(/settlement verification failed/i);

    expect(
      vendorInvoiceJournalService.verifyVendorPaymentJournalSettlements,
    ).toHaveBeenCalledWith({
      company: 'm-p',
      journalBatchNumber: 'JN-VERIFY',
      lines: [
        {
          lineNumber: 10,
          vendorAccount: 'Tr-000031',
          expectedInvoices: ['171'],
        },
      ],
    });
    expect(operationalLogs.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'd365fo.cash-out.settlement-verification',
        status: 'not_verified',
      }),
    );
  });

  it('preserves and labels a D365-accepted line when D365 explicitly persisted it unmarked', async () => {
    const {
      service,
      d365foClient,
      vendorInvoiceJournalService,
      vendorPaymentJournalService,
      operationalLogs,
    } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! JN-UNMARKED',
    });
    vendorInvoiceJournalService.verifyVendorPaymentJournalSettlements.mockResolvedValue(
      [
        {
          lineNumber: 187,
          status: 'NOT_VERIFIED',
          reason:
            'No settled invoice rows matched vendor RP-000003 and invoices 050-1',
          expectedVendorAccount: 'RP-000003',
          expectedInvoices: ['050-1'],
          matchedInvoices: [],
          settlementAmount: 0,
          journalBatchNumber: 'JN-UNMARKED',
          journalMarkedInvoice: '',
          settleVoucher: 'None',
          journalLineExists: true,
        },
      ],
    );

    await expect(
      service.postCashOutLinesForHeader(
        'JN-UNMARKED',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 187,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'RP-000003',
              accountTypeStr: 'Vendor',
              TRANSACTIONTEXT: '050-1',
              MarkedLines: [
                {
                  InvoiceNumber: '050-1',
                  OperationNumber: 'O25-EXP-OC-12064',
                  DocumentNumber: '15473',
                  HasWithHoldingLine: false,
                },
              ],
            },
          },
        ] as any[],
        20,
        'm-p',
      ),
    ).resolves.toEqual([{ headerId: 'JN-UNMARKED', lineNumber: 187 }]);

    expect(
      vendorPaymentJournalService.updateLineDescription,
    ).toHaveBeenCalledWith('JN-UNMARKED', 187, 'm-p', 'Unmarked - 050-1');
    expect(operationalLogs.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'd365fo.cash-out.settlement-fallback',
        status: 'unmarked',
      }),
    );
  });

  it('logs the bulk response with the per-line error correlation', async () => {
    const { service, d365foClient, operationalLogs } = buildService();
    const response = {
      StatusCode: 'Error',
      Lines: [
        { LineNumber: 4, Success: true },
        { LineNumber: 7, Success: false, Message: 'Dimension is not valid' },
      ],
    };
    d365foClient.post.mockResolvedValueOnce(response);

    await expect(
      service.postCashOutLinesForHeader(
        'JN-LOG',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 4,
            cashDirection: 'out',
            customLineApiBody: { journalNum: '', AccountNum: '5019' },
          },
          {
            dataAreaId: 'm-p',
            LineNumber: 7,
            cashDirection: 'out',
            customLineApiBody: { journalNum: '', AccountNum: '5020' },
          },
        ] as any[],
        20,
        'm-p',
      ),
    ).rejects.toThrow('line 7: Dimension is not valid');

    const responseLog = operationalLogs.emit.mock.calls
      .map(([event]: [any]) => event)
      .find(
        (event: any) => event.eventType === 'd365fo.cash-out.bulk-response',
      );

    expect(responseLog.level).toBe('error');
    expect(responseLog.metadata).toEqual(
      expect.objectContaining({
        journalNum: 'JN-LOG',
        lineNumbers: [4, 7],
        failedLineNumbers: [7],
        uncorrelatedFailureCount: 0,
        failures: [
          expect.objectContaining({
            lineNumber: 7,
            correlated: true,
            message: 'Dimension is not valid',
          }),
        ],
      }),
    );
    expect(responseLog.payload.response.body).toEqual(response);
  });

  it('sends each line exactly as the documented Lines contract', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! Mesco-000013758',
    });

    const documentedLine = {
      journalNum: '',
      AccountNum: '5019',
      accountTypeStr: 'Vendor',
      BANKTRANSACTIONTYPE: 'Cash',
      CENTRALBANKPURPOSECODE: '',
      CENTRALBANKPURPOSETEXT: '',
      company: 'm-p',
      creditAmount: 0,
      currency: 'EGP',
      debitAmount: 5000,
      DEFAULTDIMENSIONDISPLAYVALUE: 'account-dimensions',
      offsetDEFAULTDIMENSIONDISPLAYVALUE: 'offset-dimensions',
      ExchangeRate: 100,
      FinTagStr: 'financial-tags',
      ISPREPAYMENT: 'No',
      ITEMWITHHOLDINGTAXGROUP: '',
      offsetAccountDisplayValue: 'PSD EG',
      OffsetAccountTypeStr: '',
      OffsetCompany: 'm-p',
      OFFSETFINTAGDISPLAYVALUE: 'offset-financial-tags',
      OFFSETTRANSACTIONTEXT: 'CashOut - DMT EG-1',
      PAYMENTID: '221872',
      PAYMENTMETHODNAME: '',
      PAYMENTNOTES: 'Direct - Fleet January 2026 (Cash)',
      PAYMENTREFERENCE: 'CashOut - DMT EG-1 - Fleet',
      PAYMENTSPECIFICATION: '',
      PostingProfile: 'V-PP',
      TaxGroup: 'Non-Taxabl',
      TAXITEMGROUP: '',
      transDate: '2026-01-01T00:00:00',
      TRANSACTIONTEXT: 'Direct - Fleet January 2026 (Cash)',
      DocumentNum: '15925',
      DocumentDate: '2026-01-01T00:00:00',
      ReportingExchangeRate: 2.09863588667366,
      VendorGroup: 'Custody',
    };

    await service.postCashOutLinesForHeader(
      'Mesco-000013758',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          cashDirection: 'out',
          customLineApiBody: documentedLine,
        } as any,
      ],
      20,
      'm-p',
    );

    // Same values as the documented body: journalNum is filled in,
    // accountTypeStr is lowercased, the two offset display values move to the
    // PascalCase spelling the endpoint looks up, and VendorGroup stays present
    // (FO jsonMap.lookup("VendorGroup") has no exists() guard).
    const {
      offsetDEFAULTDIMENSIONDISPLAYVALUE,
      offsetAccountDisplayValue,
      ...documentedRest
    } = documentedLine;

    expect(d365foClient.post.mock.calls[0][1]).toEqual({
      _contract: {
        Lines: [
          {
            ...documentedRest,
            journalNum: 'Mesco-000013758',
            accountTypeStr: 'vendor',
            VendorGroup: 'Custody',
            OffsetDEFAULTDIMENSIONDISPLAYVALUE:
              offsetDEFAULTDIMENSIONDISPLAYVALUE,
            OffsetAccountDisplayValue: offsetAccountDisplayValue,
          },
        ],
      },
    });
  });

  it('correlates a bulk API error with the returned journal line number', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Error',
      Message: 'One or more lines failed.',
      Lines: [
        { LineNumber: 10, StatusCode: 'Success', Message: 'Created' },
        {
          LineNumber: 20,
          StatusCode: 'Error',
          Message: 'Vendor account is blocked.',
        },
      ],
    });

    await expect(
      service.postCashOutLinesForHeader(
        'JN-ERROR',
        [
          {
            LineNumber: 10,
            customLineApiBody: { journalNum: '', AccountNum: 'VEND001' },
          } as any,
          {
            LineNumber: 20,
            customLineApiBody: { journalNum: '', AccountNum: 'VEND002' },
          } as any,
        ],
        20,
        'm-p',
      ),
    ).rejects.toThrow('line 20: Vendor account is blocked.');

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
  });

  it('reports the detailed X++ response instead of the generic wrapper message', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Error',
      Message: 'An unexpected X++ error occurred.',
      error: {
        innererror: {
          message: 'Offset account PSD EG is invalid for this journal line.',
        },
      },
    });

    await expect(
      service.postCashOutLinesForHeader(
        'JN-XPP',
        [
          {
            LineNumber: 7,
            customLineApiBody: { journalNum: '', AccountNum: 'VEND007' },
          } as any,
        ],
        20,
        'm-p',
      ),
    ).rejects.toThrow(
      'line 7: Offset account PSD EG is invalid for this journal line.',
    );
  });

  it('reports an empty bulk response against the submitted line', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValueOnce(undefined);

    await expect(
      service.postCashOutLinesForHeader(
        'JN-EMPTY',
        [
          {
            LineNumber: 5,
            customLineApiBody: { journalNum: '', AccountNum: 'VEND005' },
          } as any,
        ],
        20,
        'm-p',
      ),
    ).rejects.toThrow('line 5: D365 returned an empty bulk response.');

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid or cross-journal lines before sending the bulk request', async () => {
    const { service, d365foClient } = buildService();

    await expect(
      service.postCashOutLinesForHeader(
        'JN-EXPECTED',
        [
          {
            LineNumber: 1,
            customLineApiBody: {
              journalNum: 'JN-DIFFERENT',
            },
          } as any,
          {
            LineNumber: 2,
          } as any,
        ],
        20,
        'm-p',
      ),
    ).rejects.toThrow('belongs to journal JN-DIFFERENT, not JN-EXPECTED');

    expect(d365foClient.post).not.toHaveBeenCalled();
  });

  it('rejects a missing line payload before sending any bulk request', async () => {
    const { service, d365foClient } = buildService();

    await expect(
      service.postCashOutLinesForHeader(
        'JN-INVALID',
        [
          {
            LineNumber: 1,
            customLineApiBody: { journalNum: '' },
          } as any,
          {
            LineNumber: 2,
          } as any,
        ],
        20,
        'm-p',
      ),
    ).rejects.toThrow('Missing customLineApiBody on cash-out line 2');

    expect(d365foClient.post).not.toHaveBeenCalled();
  });

  it('skips existing cash-out lines without calling the obsolete Vendor Line update API', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();

    vendorPaymentJournalService.listLinesForHeader.mockResolvedValueOnce([
      { LineNumber: 1 },
    ]);

    const lines: any[] = [
      {
        dataAreaId: 'USMF',
        LineNumber: 1,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'VEND001',
          accountTypeStr: 'Vendor',
          BANKTRANSACTIONTYPE: 'Transfer',
          CENTRALBANKPURPOSECODE: '',
          CENTRALBANKPURPOSETEXT: '',
          company: 'USMF',
          creditAmount: 0,
          currency: 'USD',
          debitAmount: 1000,
          DEFAULTDIMENSIONDISPLAYVALUE: '',
          offsetDEFAULTDIMENSIONDISPLAYVALUE: '',
          FinTagStr: 'TAG1',
          ISPREPAYMENT: 'No',
          ITEMWITHHOLDINGTAXGROUP: '',
          MARKEDINVOICE: '',
          offsetAccountDisplayValue: 'BANK001',
          OffsetAccountTypeStr: 'Bank',
          OffsetCompany: 'USMF',
          OFFSETFINTAGDISPLAYVALUE: 'TAG2',
          OFFSETTRANSACTIONTEXT: '',
          PAYMENTID: '',
          PAYMENTMETHODNAME: 'Bank',
          PAYMENTNOTES: '',
          PAYMENTREFERENCE: '',
          PAYMENTSPECIFICATION: '',
          PostingProfile: 'V-PP',
          TaxGroup: 'Non-Taxabl',
          TAXITEMGROUP: '',
          transDate: '2026-04-21T00:00:00',
          TRANSACTIONTEXT: 'Vendor payment',
          Voucher: '',
        },
      },
    ];

    await service.postCashOutLinesForHeader('JN000123', lines, 20, 'USMF');

    expect(d365foClient.post).not.toHaveBeenCalled();
    expect(
      vendorPaymentJournalService.updateLineFinancialTags,
    ).not.toHaveBeenCalled();
  });

  it('preserves a marked cash-out line and returns the original remaining-amount error', async () => {
    const { service, d365foClient } = buildService();
    const buildUnmarkedCashLineSpy = jest.spyOn(
      service as any,
      'buildUnmarkedCashLine',
    );

    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Error',
      Message:
        'The amount of the Invoice: 2025001409 is greater than the remain amount.',
    });

    await expect(
      service.postCashOutLinesForHeader(
        'Mesco-000013709',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 9,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              MarkedLines: [
                {
                  InvoiceNumber: '2025001409',
                  OperationNumber: 'OP-1',
                  DocumentNumber: '',
                  HasWithHoldingLine: false,
                },
              ],
              PAYMENTNOTES: 'Vendor Payment - Freight Jan 2026 (Transfer)',
              TRANSACTIONTEXT: 'Vendor Payment - Freight Jan 2026 (Transfer)',
            },
          } as any,
        ],
        20,
        'm-p',
      ),
    ).rejects.toThrow(
      'line 9: The amount of the Invoice: 2025001409 is greater than the remain amount.',
    );

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(buildUnmarkedCashLineSpy).not.toHaveBeenCalled();
    expect(d365foClient.post.mock.calls[0][1]._contract.Lines[0]).toMatchObject(
      {
        journalNum: 'Mesco-000013709',
        MarkedLines: [expect.objectContaining({ InvoiceNumber: '2025001409' })],
        PAYMENTNOTES: 'Vendor Payment - Freight Jan 2026 (Transfer)',
        TRANSACTIONTEXT: 'Vendor Payment - Freight Jan 2026 (Transfer)',
      },
    );
  });

  it('fails the marked bulk request without sending an unmarked retry when FO rejects the whole TTS chunk', async () => {
    const { service, d365foClient } = buildService();
    const buildUnmarkedCashLineSpy = jest.spyOn(
      service as any,
      'buildUnmarkedCashLine',
    );

    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Error',
      Message:
        'The amount of the Invoice: 2025001409 is greater than the remaining amount.',
    });

    await expect(
      service.postCashOutLinesForHeader(
        'JN-TTS',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 1,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'VEND1',
              MarkedLines: [
                {
                  InvoiceNumber: '2025001409',
                  OperationNumber: '',
                  DocumentNumber: '',
                  HasWithHoldingLine: false,
                },
              ],
              PAYMENTNOTES: 'Pay 1',
              TRANSACTIONTEXT: 'Pay 1',
            },
          } as any,
          {
            dataAreaId: 'm-p',
            LineNumber: 2,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'VEND2',
              MarkedLines: [
                {
                  InvoiceNumber: '2025001410',
                  OperationNumber: '',
                  DocumentNumber: '',
                  HasWithHoldingLine: false,
                },
              ],
              PAYMENTNOTES: 'Pay 2',
              TRANSACTIONTEXT: 'Pay 2',
            },
          } as any,
        ],
        20,
        'm-p',
      ),
    ).rejects.toThrow(
      'line 1: The amount of the Invoice: 2025001409 is greater than the remaining amount.; line 2: The amount of the Invoice: 2025001409 is greater than the remaining amount.',
    );

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(buildUnmarkedCashLineSpy).not.toHaveBeenCalled();
    expect(d365foClient.post.mock.calls[0][1]._contract.Lines).toEqual([
      expect.objectContaining({
        AccountNum: 'VEND1',
        MarkedLines: [expect.objectContaining({ InvoiceNumber: '2025001409' })],
        PAYMENTNOTES: 'Pay 1',
      }),
      expect.objectContaining({
        AccountNum: 'VEND2',
        MarkedLines: [expect.objectContaining({ InvoiceNumber: '2025001410' })],
        PAYMENTNOTES: 'Pay 2',
      }),
    ]);
  });

  it('fails the whole Lines chunk when FO returns a non-Success StatusCode', async () => {
    const { service, d365foClient } = buildService();

    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Error',
      Message: 'Dimension combination is not valid.',
    });

    await expect(
      service.postCashOutLinesForHeader(
        'JN-FAIL',
        [
          {
            LineNumber: 1,
            customLineApiBody: { journalNum: '', AccountNum: 'VEND1' },
          } as any,
          {
            LineNumber: 2,
            customLineApiBody: { journalNum: '', AccountNum: 'VEND2' },
          } as any,
        ],
        20,
        'm-p',
      ),
    ).rejects.toThrow('Dimension combination is not valid.');

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
  });

  it('isolates an uncorrelated invoice/vendor failure and keeps successful lines posted', async () => {
    const { service, d365foClient } = buildService();
    const invoiceError = {
      StatusCode: 'Failed',
      Message: 'The Invoice: BAD-INV does not belong to Vendor: Ag-000194',
    };
    d365foClient.post
      .mockResolvedValueOnce(invoiceError)
      .mockResolvedValueOnce(invoiceError)
      .mockResolvedValueOnce({ StatusCode: 'Success', Message: 'OK' })
      .mockResolvedValueOnce(invoiceError)
      .mockResolvedValueOnce({ StatusCode: 'Success', Message: 'OK' });

    const lines = [1, 2, 3].map(
      (lineNumber) =>
        ({
          dataAreaId: 'm-p',
          LineNumber: lineNumber,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'Ag-000194',
            MarkedLines: [
              {
                InvoiceNumber:
                  lineNumber === 2 ? 'BAD-INV' : `GOOD-${lineNumber}`,
                OperationNumber: '',
                DocumentNumber: `DOC-${lineNumber}`,
                HasWithHoldingLine: false,
              },
            ],
          },
        }) as any,
    );

    await expect(
      service.postCashOutLinesForHeader('JN-ISOLATE', lines, 20, 'm-p'),
    ).rejects.toThrow('line 2');

    expect(d365foClient.post).toHaveBeenCalledTimes(5);
    expect(
      d365foClient.post.mock.calls.map((call) =>
        call[1]._contract.Lines.map(
          (line: any) => line.MarkedLines[0].DocumentNumber,
        ),
      ),
    ).toEqual([
      ['DOC-1', 'DOC-2', 'DOC-3'],
      ['DOC-1', 'DOC-2'],
      ['DOC-1'],
      ['DOC-2'],
      ['DOC-3'],
    ]);
  });

  it('does not clear marked settlements for unrelated cash-out errors', async () => {
    const { service, d365foClient } = buildService();

    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Error',
      Message: 'Vendor account is blocked for transactions.',
    });

    await expect(
      service.postCashOutLinesForHeader(
        'Mesco-000013709',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 9,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              MarkedLines: [
                {
                  InvoiceNumber: '2025001409',
                  OperationNumber: 'OP-1',
                  DocumentNumber: '',
                  HasWithHoldingLine: false,
                },
              ],
            },
          } as any,
        ],
        20,
        'm-p',
      ),
    ).rejects.toThrow('Vendor account is blocked for transactions.');

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(
      d365foClient.post.mock.calls[0][1]._contract.Lines[0],
    ).toHaveProperty('MarkedLines', [
      expect.objectContaining({ InvoiceNumber: '2025001409' }),
    ]);
  });

  it('does not apply the cash-out invoice fallback to cash-in lines', async () => {
    const { service, d365foClient } = buildService();

    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Error',
      Message:
        'The amount of the Invoice: 2025001409 is greater than the remaining amount.',
    });

    await expect(
      service.postCashInLinesForHeader(
        'Mesco-000013709',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 9,
            cashDirection: 'in',
            customLineApiBody: {
              journalNum: '',
              MARKEDINVOICE: '2025001409',
            },
          } as any,
        ],
        20,
        'm-p',
      ),
    ).rejects.toThrow('greater than the remaining amount');

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
  });

  it('retains the unmarked-invoice retry for outbound AR routes using the cash-in endpoint', async () => {
    const { service, d365foClient } = buildService();

    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Error',
        Message:
          'The amount of the Invoice: 2025001409 is greater than the remaining amount.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: 'Success! AR-0001',
      });

    await service.postCashInLinesForHeader(
      'AR-0001',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          cashDirection: 'in',
          customLineApiBody: {
            journalNum: '',
            MARKEDINVOICE: '2025001409',
            PAYMENTNOTES: 'DownPayment - Freight Jan 2026',
            TRANSACTIONTEXT: 'DownPayment - Freight Jan 2026',
          },
        } as any,
      ],
      20,
      undefined,
      undefined,
      true,
    );

    expect(d365foClient.post).toHaveBeenCalledTimes(2);
    expect(d365foClient.post.mock.calls[0][0]).toContain(
      '/addLedgerJournalTransCustPaym',
    );
    expect(d365foClient.post.mock.calls[1][1]._contract.Lines[0]).toMatchObject(
      {
        MarkedLines: [],
        PAYMENTNOTES: 'DownPayment - Freight Jan 2026 - unmarked',
        TRANSACTIONTEXT: 'DownPayment - Freight Jan 2026 - unmarked',
      },
    );
  });

  it('fails closed when routed-line idempotency lookup cannot be verified', async () => {
    const { service, d365foClient } = buildService();
    const existingLinesLoader = jest
      .fn()
      .mockRejectedValue(new Error('LedgerJournalLines unavailable'));

    await expect(
      service.postCashOutLinesForHeader(
        'Mesco-000020045',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 1,
            cashDirection: 'out',
            customLineApiBody: { journalNum: '' },
          } as any,
        ],
        20,
        'm-p',
        existingLinesLoader,
      ),
    ).rejects.toThrow('posting was stopped to prevent duplicates');

    expect(existingLinesLoader).toHaveBeenCalledTimes(1);
    expect(d365foClient.post).not.toHaveBeenCalled();
  });
});
