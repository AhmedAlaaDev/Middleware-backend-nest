import { CustomerPaymentJournalService } from './customer-payment-journal.service';

describe('CustomerPaymentJournalService - cash custom line APIs', () => {
  function buildService() {
    const d365foClient = {
      post: jest.fn(),
      get: jest.fn().mockResolvedValue({ value: [] }),
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
      listJournalLineDetails: jest.fn().mockResolvedValue([]),
      updateLineFinancialTags: jest.fn().mockResolvedValue(undefined),
      updateLineDescription: jest.fn().mockResolvedValue(undefined),
    };

    const vendorInvoiceJournalService = {
      verifyVendorPaymentJournalSettlements: jest.fn().mockResolvedValue([]),
      createVendorPaymentJournalLineSettlements: jest
        .fn()
        .mockResolvedValue([]),
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

    // Most tests in this suite predate Cash-Out's source-UniqueId contract and
    // focus on another payload concern. Give those handcrafted fixtures one
    // valid default UniqueId per call; tests for grouping/validation set
    // PAYMENTID explicitly and are therefore left unchanged.
    const postCashOutLinesForHeader =
      service.postCashOutLinesForHeader.bind(service);
    jest
      .spyOn(service, 'postCashOutLinesForHeader')
      .mockImplementation((headerKey, lines, ...args) =>
        postCashOutLinesForHeader(
          headerKey,
          lines.map((line) =>
            line.customLineApiBody &&
            line.customLineApiBody.PAYMENTID === undefined
              ? {
                  ...line,
                  customLineApiBody: {
                    ...line.customLineApiBody,
                    PAYMENTID: `TEST-${headerKey}`,
                  },
                }
              : line,
          ),
          ...args,
        ),
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
          MarkedLines: [
            {
              InvoiceNumber: 'INV-0001',
              OperationNumber: '',
              DocumentNumber: 'DOC-1001',
              HasWithHoldingLine: false,
            },
          ],
        },
      },
    ];

    await service.postCashInLinesForHeader('JN000123', lines, 20, 'USMF');

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    const [endpoint, body] = d365foClient.post.mock.calls[0];

    expect(endpoint).toContain('/addLedgerJournalTransCustPaym');
    expect(body._contract.Lines).toHaveLength(1);
    const postedLine = body._contract.Lines[0];
    expect(postedLine).toHaveProperty('JournalNum', 'JN000123');
    expect(postedLine).toHaveProperty('AccountNum', 'CUST001');
    expect(postedLine).toHaveProperty('AccountTypeStr', 'Cust');
    expect(postedLine).toHaveProperty('TransDate', '2026-04-21T00:00:00');
    expect(postedLine).toHaveProperty('DocumentNum', 'DOC-1001');
    expect(postedLine).toHaveProperty('DocumentDate', '2026-04-20T00:00:00');
    expect(postedLine).toHaveProperty('ExchangeRate');
    expect(postedLine.MarkedLines).toEqual([
      {
        InvoiceNumber: 'INV-0001',
        OperationNumber: '',
        DocumentNumber: 'DOC-1001',
        HasWithHoldingLine: false,
      },
    ]);
    expect(postedLine).not.toHaveProperty('EXCHANGERATE');
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
    expect(postedLine).toHaveProperty('JournalNum', 'JN000123');
    expect(postedLine).toHaveProperty('AccountNum', 'VEND001');
    expect(postedLine).toHaveProperty('AccountTypeStr', 'Vendor');
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

  function cashOutLine(lineNumber: number) {
    return {
      dataAreaId: 'USMF',
      LineNumber: lineNumber,
      cashDirection: 'out',
      customLineApiBody: {
        journalNum: '',
        AccountNum: 'VEND001',
        accountTypeStr: 'Vendor',
        company: 'USMF',
        creditAmount: 0,
        currency: 'USD',
        debitAmount: 1000,
        PAYMENTID: 'PAY456',
        transDate: '2026-04-21T00:00:00',
      },
    };
  }

  it('continues a cash-out UniqueId when the custom service times out after D365 has the lines', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();
    vendorPaymentJournalService.listLinesForHeader
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ LineNumber: 1 }]);
    d365foClient.post.mockRejectedValueOnce(
      new Error('timeout of 600000ms exceeded'),
    );

    await expect(
      service.postCashOutLinesForHeader(
        'JN000123',
        [cashOutLine(1)] as any,
        20,
        'USMF',
      ),
    ).resolves.toEqual([{ headerId: 'JN000123', lineNumber: 1 }]);
    expect(d365foClient.post).toHaveBeenCalledTimes(1);
  });

  it('still fails a cash-out timeout when D365 does not have the lines', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();
    (service as { timeoutRecoveryDelaysMs: number[] }).timeoutRecoveryDelaysMs =
      [0];
    vendorPaymentJournalService.listLinesForHeader.mockResolvedValue([]);
    d365foClient.post.mockRejectedValueOnce(
      new Error('timeout of 600000ms exceeded'),
    );

    await expect(
      service.postCashOutLinesForHeader(
        'JN000123',
        [cashOutLine(1)] as any,
        20,
        'USMF',
      ),
    ).rejects.toThrow('timeout of 600000ms exceeded');
    expect(d365foClient.post).toHaveBeenCalledTimes(1);
  });

  it('stops a timed-out cash-out UniqueId when only some of its lines exist', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();
    (service as { timeoutRecoveryDelaysMs: number[] }).timeoutRecoveryDelaysMs =
      [0];
    vendorPaymentJournalService.listLinesForHeader
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ LineNumber: 1 }]);
    d365foClient.post.mockRejectedValueOnce(
      new Error('timeout of 600000ms exceeded'),
    );

    await expect(
      service.postCashOutLinesForHeader(
        'JN000123',
        [cashOutLine(1), cashOutLine(2)] as any,
        20,
        'USMF',
      ),
    ).rejects.toThrow('only 1/2 submitted lines are present');
    expect(d365foClient.post).toHaveBeenCalledTimes(1);
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
    expect(postedLines[1]).not.toHaveProperty('MarkedLines');
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
        DebitAmount: 150,
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
        JournalNum: 'JN-BULK',
        AccountTypeStr: 'Vendor',
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
        JournalNum: 'JN-BULK',
        AccountTypeStr: 'Ledger',
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

  it('posts one request per UniqueId in Custody, other, then empty VendorGroup order', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValue({
      StatusCode: 'Success',
      Message: 'Success',
    });

    const line = (
      lineNumber: number,
      paymentId: string,
      vendorGroup: string,
    ) => ({
      dataAreaId: 'm-p',
      LineNumber: lineNumber,
      cashDirection: 'out',
      customLineApiBody: {
        journalNum: '',
        AccountNum: `VEND${lineNumber}`,
        accountTypeStr: 'Vendor',
        debitAmount: 100,
        PAYMENTID: paymentId,
        VendorGroup: vendorGroup,
      },
    });
    const lines: any[] = [
      line(1, 'OTHER-1', 'Trade'),
      line(2, 'EMPTY-1', ''),
      line(3, 'MIXED-CUSTODY', 'Trade'),
      line(4, 'MIXED-CUSTODY', ' custody '),
      line(5, 'OTHER-2', 'Supplier'),
    ];

    const result = await service.postCashOutLinesForHeader(
      'JN-ORDER',
      lines,
      20,
      'm-p',
    );

    expect(result).toHaveLength(5);
    expect(d365foClient.post).toHaveBeenCalledTimes(4);
    const requests = d365foClient.post.mock.calls.map(
      ([, body]: [string, any]) => body._contract.Lines,
    );
    expect(requests.map((request: any[]) => request.length)).toEqual([
      2, 1, 1, 1,
    ]);
    expect(requests.map((request: any[]) => request[0].PAYMENTID)).toEqual([
      'MIXED-CUSTODY',
      'OTHER-1',
      'OTHER-2',
      'EMPTY-1',
    ]);
    expect(requests[0].map((posted: any) => posted.AccountNum)).toEqual([
      'VEND3',
      'VEND4',
    ]);
  });

  it('posts each invoice of a Custody Settlement UniqueId in its own request', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValue({
      StatusCode: 'Success',
      Message: 'Success',
    });

    const line = (
      lineNumber: number,
      invoice: string,
      debit: number,
      credit: number,
      vendorGroup = '',
    ) => ({
      dataAreaId: 'm-p',
      LineNumber: lineNumber,
      cashDirection: 'out',
      groupInvoice: invoice,
      customLineApiBody: {
        journalNum: '',
        AccountNum: debit > 0 ? 'Sl-000036' : '3210',
        accountTypeStr: 'Vendor',
        debitAmount: debit,
        creditAmount: credit,
        PAYMENTID: '475848',
        VendorGroup: vendorGroup,
        MarkedLines: [
          {
            InvoiceNumber: invoice,
            OperationNumber: 'OP-1',
            DocumentNumber: '16627',
            HasWithHoldingLine: false,
          },
        ],
      },
    });

    await service.postCashOutLinesForHeaderAllowingSkips(
      'JN-SPLIT',
      [
        line(1, '5810265983', 0, 1.59, 'Custody'),
        line(2, '5810265983', 1.59, 0),
        // Each invoice group must balance on its own to be its own request.
        line(3, '5815371117', 0, 34.1886, 'Custody'),
        line(4, '5815371117', 34.1886, 0),
      ] as any[],
      20,
      'm-p',
    );

    const requests = d365foClient.post.mock.calls.map(
      ([, body]: [string, any]) => body._contract.Lines,
    );
    expect(requests).toHaveLength(2);
    expect(
      requests.map((posted: any[]) =>
        posted.map((row) => row.MarkedLines?.[0]?.InvoiceNumber || row.AccountNum),
      ),
    ).toEqual([
      ['5810265983', '5810265983'],
      ['5815371117', '5815371117'],
    ]);
  });

  it('keeps zero-placeholder and blank invoice lines in one ordered Custody Settlement request', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValue({
      StatusCode: 'Success',
      Message: '10 line(s) processed successfully.',
    });

    const accounts = [
      '5014',
      '223404',
      '512301',
      'PSD EG',
      '5014',
      '223404',
      '512301',
      '5014',
      '223404',
      '512301',
    ];
    const lines = accounts.map((account, index) => {
      const isVendor = account === '5014';
      return {
        dataAreaId: 'm-p',
        LineNumber: index + 1,
        cashDirection: 'out',
        groupInvoice: isVendor ? '000' : '',
        customLineApiBody: {
          journalNum: '',
          AccountNum: account,
          accountTypeStr:
            account === 'PSD EG' ? 'RCash' : isVendor ? 'Vendor' : 'Ledger',
          PAYMENTID: '542099',
          VendorGroup: isVendor ? 'Custody' : '',
          ...(isVendor
            ? {
                MarkedLines: [
                  {
                    InvoiceNumber: '',
                    OperationNumber: `OP-${index + 1}`,
                    DocumentNumber: `DOC-${index + 1}`,
                    HasWithHoldingLine: false,
                  },
                ],
              }
            : {}),
        },
      };
    });

    await service.postCashOutLinesForHeaderAllowingSkips(
      'Mesco-000016205',
      lines as any[],
      20,
      'm-p',
    );

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(
      d365foClient.post.mock.calls[0][1]._contract.Lines.map(
        (line: any) => line.AccountNum,
      ),
    ).toEqual(accounts);
  });

  it('keeps a 223304 ledger companion in the same invoice request', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValue({
      StatusCode: 'Success',
      Message: 'Success',
    });

    await service.postCashOutLinesForHeaderAllowingSkips(
      'JN-WHT-SPLIT',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          cashDirection: 'out',
          groupInvoice: '5815371117',
          customLineApiBody: {
            journalNum: '',
            AccountNum: '3210',
            accountTypeStr: 'Vendor',
            creditAmount: 33.2889,
            PAYMENTID: '475848',
            VendorGroup: 'Custody',
            MarkedLines: [
              {
                InvoiceNumber: '5815371117',
                OperationNumber: 'OP-1',
                DocumentNumber: '16627',
                HasWithHoldingLine: false,
              },
            ],
          },
        },
        {
          dataAreaId: 'm-p',
          LineNumber: 2,
          cashDirection: 'out',
          groupInvoice: '5815371117',
          customLineApiBody: {
            journalNum: '',
            AccountNum: '223304',
            accountTypeStr: 'Ledger',
            creditAmount: 0.9,
            PAYMENTID: '475848',
          },
        },
        {
          dataAreaId: 'm-p',
          LineNumber: 3,
          cashDirection: 'out',
          groupInvoice: '5815371117',
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'Sl-000036',
            accountTypeStr: 'Vendor',
            debitAmount: 34.1886,
            PAYMENTID: '475848',
            MarkedLines: [
              {
                InvoiceNumber: '5815371117',
                OperationNumber: 'OP-1',
                DocumentNumber: '16627',
                HasWithHoldingLine: true,
              },
            ],
          },
        },
        {
          dataAreaId: 'm-p',
          LineNumber: 4,
          cashDirection: 'out',
          groupInvoice: '5810265983',
          customLineApiBody: {
            journalNum: '',
            AccountNum: '3210',
            accountTypeStr: 'Vendor',
            creditAmount: 1.59,
            PAYMENTID: '475848',
            VendorGroup: 'Custody',
            MarkedLines: [
              {
                InvoiceNumber: '5810265983',
                OperationNumber: 'OP-1',
                DocumentNumber: '16627',
                HasWithHoldingLine: false,
              },
            ],
          },
        },
        {
          dataAreaId: 'm-p',
          LineNumber: 5,
          cashDirection: 'out',
          groupInvoice: '5810265983',
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'Sl-000036',
            accountTypeStr: 'Vendor',
            debitAmount: 1.59,
            PAYMENTID: '475848',
            MarkedLines: [
              {
                InvoiceNumber: '5810265983',
                OperationNumber: 'OP-1',
                DocumentNumber: '16627',
                HasWithHoldingLine: false,
              },
            ],
          },
        },
      ] as any[],
      20,
      'm-p',
    );

    const requests = d365foClient.post.mock.calls.map(
      ([, body]: [string, any]) => body._contract.Lines,
    );
    expect(requests).toHaveLength(2);
    expect(
      requests.map((posted: any[]) => posted.map((row: any) => row.AccountNum)),
    ).toEqual([
      ['3210', '223304', 'Sl-000036'],
      ['3210', 'Sl-000036'],
    ]);
  });

  it('keeps a main and 223304 companion with the same UniqueId in one request', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValue({
      StatusCode: 'Success',
      Message: 'Success',
    });
    const mark = {
      InvoiceNumber: '008',
      OperationNumber: 'O26-EXP-OC-6',
      DocumentNumber: '16300',
      HasWithHoldingLine: true,
    };
    const pair: any[] = [
      {
        dataAreaId: 'm-p',
        LineNumber: 1,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'Su-000009',
          accountTypeStr: 'Vendor',
          debitAmount: 2850,
          MarkedLines: [mark],
          PAYMENTID: 'UNIQUE-WHT',
        },
      },
      {
        dataAreaId: 'm-p',
        LineNumber: 2,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'Su-000009',
          accountTypeStr: 'Vendor',
          debitAmount: 150,
          offsetAccountDisplayValue: '223304|dims',
          MarkedLines: [{ ...mark, HasWithHoldingLine: false }],
          PAYMENTID: 'UNIQUE-WHT',
        },
      },
    ];

    await service.postCashOutLinesForHeader('JN-WHT-BOUNDARY', pair, 20, 'm-p');

    const requests = d365foClient.post.mock.calls.map(
      ([, body]: [string, any]) => body._contract.Lines,
    );
    expect(requests.map((lines: any[]) => lines.length)).toEqual([2]);
    expect(requests[0].map((line: any) => line.DebitAmount)).toEqual([
      2850, 150,
    ]);
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

  it('accepts a cash-out line when D365 saves it without settling the invoice', async () => {
    const {
      service,
      d365foClient,
      vendorInvoiceJournalService,
      vendorPaymentJournalService,
    } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! JN-VERIFY',
    });

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
    ).resolves.toEqual([{ headerId: 'JN-VERIFY', lineNumber: 10 }]);

    expect(
      vendorInvoiceJournalService.verifyVendorPaymentJournalSettlements,
    ).not.toHaveBeenCalled();
    expect(
      vendorInvoiceJournalService.createVendorPaymentJournalLineSettlements,
    ).not.toHaveBeenCalled();
    expect(
      vendorPaymentJournalService.updateLineDescription,
    ).not.toHaveBeenCalled();
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
    expect(d365foClient.post.mock.calls[0][1]).toEqual({
      _contract: {
        Lines: [
          expect.objectContaining({
            JournalNum: 'Mesco-000013758',
            AccountTypeStr: 'Vendor',
            VendorGroup: 'Custody',
            OffsetDEFAULTDIMENSIONDISPLAYVALUE:
              documentedLine.offsetDEFAULTDIMENSIONDISPLAYVALUE,
            OffsetAccountDisplayValue: documentedLine.offsetAccountDisplayValue,
          }),
        ],
      },
    });
  });

  it('repairs VendorGroup for a legacy custody document-operation marked line', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: '1 line(s) processed successfully.',
    });

    await service.postCashOutLinesForHeader(
      'Mesco-000015271',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: '3066',
            accountTypeStr: 'Vendor',
            company: 'm-p',
            currency: 'EGP',
            debitAmount: 0,
            creditAmount: 500,
            VendorGroup: '',
            MarkedLines: [
              {
                InvoiceNumber: '',
                OperationNumber: 'O26-EXP-OC-1171',
                DocumentNumber: '17437',
                HasWithHoldingLine: false,
              },
            ],
          },
        } as any,
      ],
      20,
      'm-p',
    );

    expect(d365foClient.post.mock.calls[0][1]._contract.Lines[0]).toEqual(
      expect.objectContaining({
        AccountTypeStr: 'Vendor',
        VendorGroup: 'Custody',
      }),
    );
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

  it('rejects a missing Cash-Out PAYMENTID before sending any request', async () => {
    const { service, d365foClient } = buildService();

    await expect(
      service.postCashOutLinesForHeader(
        'JN-MISSING-ID',
        [
          {
            LineNumber: 7,
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'VEND-7',
              PAYMENTID: '',
            },
          } as any,
        ],
        20,
        'm-p',
      ),
    ).rejects.toThrow(
      'Cash-out line 7 in header JN-MISSING-ID is missing PAYMENTID',
    );
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
          PAYMENTID: 'EXISTING-1',
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
        JournalNum: 'Mesco-000013709',
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

  it('stops on an uncorrelated invoice/vendor failure without splitting the request', async () => {
    const { service, d365foClient } = buildService();
    const invoiceError = {
      StatusCode: 'Failed',
      Message: 'The Invoice: BAD-INV does not belong to Vendor: Ag-000194',
    };
    d365foClient.post.mockResolvedValueOnce(invoiceError);

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
    ).rejects.toThrow(
      'The Invoice: BAD-INV does not belong to Vendor: Ag-000194',
    );

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(d365foClient.post.mock.calls[0][1]._contract.Lines).toHaveLength(3);
  });

  it('stops before submitting the next request when a bulk request fails', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Error',
        Message: 'Dimension combination is not valid.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: 'Must not run',
      });

    const lines = Array.from({ length: 101 }, (_, index) => ({
      dataAreaId: 'm-p',
      LineNumber: index + 1,
      cashDirection: 'out',
      customLineApiBody: {
        journalNum: '',
        AccountNum: `VEND-${index + 1}`,
        PAYMENTID: index < 100 ? 'FIRST-REQUEST' : 'SECOND-REQUEST',
      },
    }));

    await expect(
      service.postCashOutLinesForHeader('JN-STOP', lines as any[], 20, 'm-p'),
    ).rejects.toThrow('Dimension combination is not valid.');

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(d365foClient.post.mock.calls[0][1]._contract.Lines).toHaveLength(
      100,
    );
  });

  it('posts a UniqueId with more than 100 lines in a single request', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValue({
      StatusCode: 'Success',
      Message: 'Success',
    });
    const lines = Array.from({ length: 186 }, (_, index) => ({
      dataAreaId: 'm-p',
      LineNumber: index + 1,
      cashDirection: 'out',
      customLineApiBody: {
        journalNum: '',
        AccountNum: `VEND-${index + 1}`,
        PAYMENTID: '488810',
      },
    }));

    await service.postCashOutLinesForHeader(
      'JN-OVERSIZE',
      lines as any[],
      20,
      'm-p',
    );

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(d365foClient.post.mock.calls[0][1]._contract.Lines).toHaveLength(
      186,
    );
  });

  it('skips a failed UniqueId and continues posting later UniqueIds', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Error',
        Message: 'Dimension combination is not valid.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: 'Posted',
      });

    const lines = [
      {
        dataAreaId: 'm-p',
        LineNumber: 1,
        sourceLineNumber: 841,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'Sl-000036',
          // Self-balancing line (carries an offset): this test covers skip
          // mechanics, not voucher balance.
          OffsetAccountTypeStr: 'Bank',
          PAYMENTID: '475761',
          debitAmount: 298.86,
          creditAmount: 0,
          MarkedLines: [
            {
              InvoiceNumber: '5815372458',
              OperationNumber: '',
              DocumentNumber: '16760',
              HasWithHoldingLine: false,
            },
          ],
        },
      },
      {
        dataAreaId: 'm-p',
        LineNumber: 2,
        sourceLineNumber: 900,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'Sl-000020',
          OffsetAccountTypeStr: 'Bank',
          PAYMENTID: '999001',
          debitAmount: 100,
          creditAmount: 0,
        },
      },
    ];

    const result = await service.postCashOutLinesForHeaderAllowingSkips(
      'JN-SKIP',
      lines as any[],
      20,
      'm-p',
    );

    expect(d365foClient.post).toHaveBeenCalledTimes(2);
    expect(result.postedLines).toEqual([
      { headerId: 'JN-SKIP', lineNumber: 2 },
    ]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        uniqueId: '475761',
        excelLineNumbers: [841],
        d365LineNumbers: [1],
        invoiceNumber: '5815372458',
        phase: 'post',
        error: expect.stringContaining('Dimension combination is not valid.'),
      }),
    ]);
  });

  it.each([
    [
      'Freight',
      'This transaction has been marked for settlement by Vendor Payment Freight Mesco-000015604 in company m-p.',
    ],
    [
      'Fleet',
      'This transaction has been marked for settlement by Vendor Payment Fleet Mesco-000015604 in company m-p.',
    ],
  ] as const)(
    'uploads an already-marked %s UniqueId without MarkedLines and OData-marks it',
    async (_target, alreadyMarked) => {
    const { service, d365foClient, vendorInvoiceJournalService } =
      buildService();
    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Error',
        Message: alreadyMarked,
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: 'Posted unmarked',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: 'Posted',
      });
    vendorInvoiceJournalService.verifyVendorPaymentJournalSettlements.mockResolvedValue(
      [
        {
          lineNumber: 2,
          status: 'VERIFIED',
          settleVoucher: 'SelectedTransact',
          journalLineExists: true,
          journalMarkedInvoice: 'INV-OK',
          matchedInvoices: ['INV-OK'],
          reason: '',
        },
      ],
    );

    const result = await service.postCashOutLinesForHeaderAllowingSkips(
      'Mesco-000015604',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          sourceLineNumber: 900,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'Sl-000020',
            accountTypeStr: 'Vendor',
            // Self-balancing line (carries an offset): this test covers the
            // already-marked retry mechanics, not voucher balance.
            OffsetAccountTypeStr: 'Bank',
            VendorGroup: 'Shiplines',
            currency: 'EGP',
            PAYMENTID: '466596',
            debitAmount: 100,
            creditAmount: 0,
            MarkedLines: [
              {
                InvoiceNumber: 'INV-MARKED',
                OperationNumber: '',
                DocumentNumber: 'DOC-MARKED',
                HasWithHoldingLine: false,
              },
            ],
          },
        },
        {
          dataAreaId: 'm-p',
          LineNumber: 2,
          sourceLineNumber: 901,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'Sl-000036',
            OffsetAccountTypeStr: 'Bank',
            PAYMENTID: '999001',
            debitAmount: 200,
            creditAmount: 0,
            MarkedLines: [
              {
                InvoiceNumber: 'INV-OK',
                OperationNumber: '',
                DocumentNumber: 'DOC-OK',
                HasWithHoldingLine: false,
              },
            ],
          },
        },
      ] as any[],
      20,
      'm-p',
    );

    expect(d365foClient.post).toHaveBeenCalledTimes(3);
    expect(
      d365foClient.post.mock.calls[0][1]._contract.Lines[0].MarkedLines,
    ).toEqual([expect.objectContaining({ InvoiceNumber: 'INV-MARKED' })]);
    expect(
      d365foClient.post.mock.calls[1][1]._contract.Lines[0].MarkedLines,
    ).toBeUndefined();
    expect(
      d365foClient.post.mock.calls[2][1]._contract.Lines[0].MarkedLines,
    ).toEqual([expect.objectContaining({ InvoiceNumber: 'INV-OK' })]);
    expect(result.postedLines).toEqual([
      { headerId: 'Mesco-000015604', lineNumber: 1 },
      { headerId: 'Mesco-000015604', lineNumber: 2 },
    ]);
    expect(result.skipped).toEqual([]);
    expect(
      vendorInvoiceJournalService.createVendorPaymentJournalLineSettlements,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        continueOnError: true,
        targets: [
          expect.objectContaining({
            uniqueId: '466596',
            invoiceNumber: 'INV-MARKED',
            lineNumber: 1,
          }),
        ],
      }),
    );
    },
  );

  it('does not retry already-marked UniqueIds without MarkedLines on Vendor Payment', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Error',
      Message:
        'This transaction has been marked for settlement by Vendor Payment Freight Mesco-000015604 in company m-p.',
    });

    await expect(
      service.postCashOutLinesForHeader(
        'Mesco-000015604',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 1,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'Sl-000020',
              PAYMENTID: '466596',
              MarkedLines: [
                {
                  InvoiceNumber: 'INV-MARKED',
                  OperationNumber: '',
                  DocumentNumber: 'DOC-MARKED',
                  HasWithHoldingLine: false,
                },
              ],
            },
          } as any,
        ],
        20,
        'm-p',
      ),
    ).rejects.toThrow('has been marked for settlement');

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(
      d365foClient.post.mock.calls[0][1]._contract.Lines[0].MarkedLines,
    ).toEqual([expect.objectContaining({ InvoiceNumber: 'INV-MARKED' })]);
  });

  it('fails closed when only part of a UniqueId already exists in D365', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();
    vendorPaymentJournalService.listLinesForHeader.mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, index) => ({ LineNumber: index + 1 })),
    );
    const lines = Array.from({ length: 101 }, (_, index) => ({
      dataAreaId: 'm-p',
      LineNumber: index + 1,
      cashDirection: 'out',
      customLineApiBody: {
        journalNum: '',
        AccountNum: `VEND-${index + 1}`,
        PAYMENTID: 'PARTIAL-UNIQUE-ID',
      },
    }));

    await expect(
      service.postCashOutLinesForHeader('JN-RESUME', lines as any[], 20, 'm-p'),
    ).rejects.toThrow(
      'Cash-out UniqueId PARTIAL-UNIQUE-ID is only partially present in D365 for header JN-RESUME (100/101 lines).',
    );

    expect(d365foClient.post).not.toHaveBeenCalled();
  });

  it('skips a partially present UniqueId and continues later UniqueIds on the Custody Settlement path', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();
    // D365 already holds the FIRST line of the UniqueId, but under its own
    // line number (7): the planned number (1) is never used as identity.
    vendorPaymentJournalService.listJournalLineDetails.mockResolvedValueOnce([
      {
        lineNumber: 7,
        paymentId: 'PARTIAL-UNIQUE-ID',
        accountType: 'Vend',
        account: 'Sl-000036',
        currency: 'EGP',
        debitCents: 1000,
        creditCents: 0,
        voucher: 'V-1',
      },
    ]);
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Posted',
    });

    const result = await service.postCashOutLinesForHeaderAllowingSkips(
      'JN-RESUME',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          sourceLineNumber: 841,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'Sl-000036',
            accountTypeStr: 'Vendor',
            currency: 'EGP',
            debitAmount: 10,
            PAYMENTID: 'PARTIAL-UNIQUE-ID',
          },
        },
        {
          dataAreaId: 'm-p',
          LineNumber: 2,
          sourceLineNumber: 842,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'Sl-000036',
            accountTypeStr: 'Vendor',
            currency: 'EGP',
            creditAmount: 10,
            PAYMENTID: 'PARTIAL-UNIQUE-ID',
          },
        },
        {
          dataAreaId: 'm-p',
          LineNumber: 3,
          sourceLineNumber: 900,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'Sl-000020',
            PAYMENTID: 'NEXT-UNIQUE-ID',
          },
        },
      ] as any[],
      20,
      'm-p',
    );

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(
      d365foClient.post.mock.calls[0][1]._contract.Lines[0].PAYMENTID,
    ).toBe('NEXT-UNIQUE-ID');
    expect(result.postedLines).toEqual([
      { headerId: 'JN-RESUME', lineNumber: 3 },
    ]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        uniqueId: 'PARTIAL-UNIQUE-ID',
        excelLineNumbers: [841, 842],
        phase: 'post',
        error: expect.stringContaining('only partially present in D365'),
      }),
    ]);
  });

  it('retries only correlated failed lines, never lines already reported successful', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Error',
        Message: 'One or more lines failed.',
        Lines: [
          { LineNumber: 1, StatusCode: 'Success', Message: 'Created' },
          {
            LineNumber: 2,
            StatusCode: 'Error',
            Message:
              'The amount of the Invoice: BAD-INV is greater than the remaining amount.',
          },
        ],
      })
      .mockResolvedValueOnce({ StatusCode: 'Success', Message: 'Created' });

    await service.postCashInLinesForHeader(
      'JN-FAILED-LINE',
      [1, 2].map(
        (lineNumber) =>
          ({
            dataAreaId: 'm-p',
            LineNumber: lineNumber,
            cashDirection: 'in',
            customLineApiBody: {
              journalNum: '',
              AccountNum: `VEND-${lineNumber}`,
              MarkedLines: [
                {
                  InvoiceNumber: lineNumber === 2 ? 'BAD-INV' : 'GOOD-INV',
                },
              ],
            },
          }) as any,
      ),
      20,
      'm-p',
      undefined,
      true,
    );

    expect(d365foClient.post).toHaveBeenCalledTimes(2);
    expect(d365foClient.post.mock.calls[1][1]._contract.Lines).toHaveLength(1);
    expect(
      d365foClient.post.mock.calls[1][1]._contract.Lines[0].AccountNum,
    ).toBe('VEND-2');
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
        PAYMENTNOTES: 'DownPayment - Freight Jan 2026 - unmarked',
        TRANSACTIONTEXT: 'DownPayment - Freight Jan 2026 - unmarked',
      },
    );
    expect(
      d365foClient.post.mock.calls[1][1]._contract.Lines[0],
    ).toHaveProperty('MarkedLines', []);
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

  it('projects the custody settlement body to the exact X++ contract', () => {
    const { service } = buildService();
    const body = (service as any).toD365BulkCashLine({
      journalNum: 'JN-CUSTODY',
      AccountNum: '3066',
      accountTypeStr: 'Vendor',
      BANKTRANSACTIONTYPE: 'Cash',
      CENTRALBANKPURPOSECODE: '',
      CENTRALBANKPURPOSETEXT: '',
      company: 'm-p',
      creditAmount: 500,
      currency: 'EGP',
      debitAmount: 0,
      DEFAULTDIMENSIONDISPLAYVALUE: 'account-dimensions',
      offsetDEFAULTDIMENSIONDISPLAYVALUE: '',
      FinTagStr: 'O26-EXP-OC-1171|tag',
      ISPREPAYMENT: 'No',
      ITEMWITHHOLDINGTAXGROUP: '',
      offsetAccountDisplayValue: '',
      OffsetAccountTypeStr: '',
      OffsetCompany: '',
      OFFSETFINTAGDISPLAYVALUE: '',
      OFFSETTRANSACTIONTEXT: '',
      PAYMENTID: 'PAY-1',
      PAYMENTMETHODNAME: 'Cash',
      PAYMENTNOTES: 'Custody settlement',
      PAYMENTREFERENCE: '',
      PAYMENTSPECIFICATION: '',
      PostingProfile: 'V-PP',
      TaxGroup: 'Non-Taxabl',
      TAXITEMGROUP: '',
      transDate: '2026-01-05T00:00:00',
      TRANSACTIONTEXT: 'Custody settlement',
      DocumentDate: '2026-01-05T00:00:00',
      DocumentNum: '17437',
      ExchangeRate: 100,
      ReportingExchangeRate: 0,
      VendorGroup: 'Custody',
      MarkedLines: [
        {
          InvoiceNumber: '',
          OperationNumber: 'O26-EXP-OC-1171',
          DocumentNumber: '17437',
          HasWithHoldingLine: false,
        },
      ],
      // These are deliberately present on the internal compatibility object;
      // none may leak to the X++ wire contract.
      ExchRate: 100,
      EXCHANGERATE: 100,
      ReportingCurrencyExchRate: 0,
      REPORTINGEXCHANGERATE: 0,
      ExchRateSecond: 100,
      IsWithholdingTaxCalculate: 'No',
      ISWITHHOLDINGTAXCALCULATE: 'No',
      MARKEDINVOICE: '',
      Voucher: '',
    });

    expect(body).toEqual({
      JournalNum: 'JN-CUSTODY',
      AccountNum: '3066',
      AccountTypeStr: 'Vendor',
      BANKTRANSACTIONTYPE: 'Cash',
      CENTRALBANKPURPOSECODE: '',
      CENTRALBANKPURPOSETEXT: '',
      Company: 'm-p',
      CreditAmount: 500,
      Currency: 'EGP',
      DebitAmount: 0,
      DEFAULTDIMENSIONDISPLAYVALUE: 'account-dimensions',
      OffsetDEFAULTDIMENSIONDISPLAYVALUE: '',
      FinTagStr: 'O26-EXP-OC-1171|tag',
      ISPREPAYMENT: 'No',
      ITEMWITHHOLDINGTAXGROUP: '',
      OffsetAccountDisplayValue: '',
      OffsetAccountTypeStr: '',
      OffsetCompany: '',
      OFFSETFINTAGDISPLAYVALUE: '',
      OFFSETTRANSACTIONTEXT: '',
      PAYMENTID: 'PAY-1',
      PAYMENTMETHODNAME: 'Cash',
      PAYMENTNOTES: 'Custody settlement',
      PAYMENTREFERENCE: '',
      PAYMENTSPECIFICATION: '',
      PostingProfile: 'V-PP',
      TaxGroup: 'Non-Taxabl',
      TAXITEMGROUP: '',
      TransDate: '2026-01-05T00:00:00',
      TRANSACTIONTEXT: 'Custody settlement',
      DocumentDate: '2026-01-05T00:00:00',
      DocumentNum: '17437',
      ExchangeRate: 100,
      ReportingExchangeRate: 0,
      VendorGroup: 'Custody',
      MarkedLines: [
        {
          InvoiceNumber: '',
          OperationNumber: 'O26-EXP-OC-1171',
          DocumentNumber: '17437',
          HasWithHoldingLine: false,
        },
      ],
    });
    expect(body).not.toHaveProperty('ExchRateSecond');
    expect(body).not.toHaveProperty('ExchRate');
    expect(body).not.toHaveProperty('EXCHANGERATE');
    expect(body).not.toHaveProperty('IsWithholdingTaxCalculate');
    expect(body).not.toHaveProperty('ISWITHHOLDINGTAXCALCULATE');
    expect(body.MarkedLines[0].HasWithHoldingLine).toBe(false);
  });
});
