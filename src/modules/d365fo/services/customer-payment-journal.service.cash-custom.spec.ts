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
      operationalLogs as any,
      logPayloads as any,
      configService as any,
    );

    return {
      service,
      d365foClient,
      vendorPaymentJournalService,
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
    expect(body._contract).toHaveProperty('journalNum', 'JN000123');
    expect(body._contract).toHaveProperty('AccountNum', 'CUST001');
    expect(body._contract).toHaveProperty('accountTypeStr', 'Cust');
    expect(body._contract).toHaveProperty('transDate', '2026-04-21T00:00:00');
    expect(body._contract).toHaveProperty('DocumentNum', 'DOC-1001');
    expect(body._contract).toHaveProperty(
      'DocumentDate',
      '2026-04-20T00:00:00',
    );
    expect(body._contract).toHaveProperty('ExchangeRate');
    expect(body._contract).toHaveProperty('EXCHANGERATE');
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
    expect(postedLine).toHaveProperty('offsetAccountDisplayValue', 'BANK001');
    expect(postedLine).toHaveProperty(
      'offsetDEFAULTDIMENSIONDISPLAYVALUE',
      'BU-001|CC-002|Dept-004',
    );
    expect(postedLine).toHaveProperty('DocumentNum', 'DOC-2002');
    expect(postedLine).toHaveProperty('DocumentDate', '2026-04-19T00:00:00');
    expect(postedLine).toHaveProperty('ExchangeRate', 100);
    // Bulk contract carries one exchange-rate field and one reporting-rate field.
    expect(postedLine).not.toHaveProperty('ExchRate');
    expect(postedLine).not.toHaveProperty('EXCHANGERATE');
    expect(postedLine).not.toHaveProperty('ReportingCurrencyExchRate');
    expect(postedLine).not.toHaveProperty('REPORTINGEXCHANGERATE');
    expect(postedLine).not.toHaveProperty('ExchRateSecond');
    expect(postedLine).not.toHaveProperty('OffsetAccountDisplayValue');
    expect(postedLine).not.toHaveProperty('OffsetDEFAULTDIMENSIONDISPLAYVALUE');
    expect(postedLine).not.toHaveProperty('Voucher');
    expect(postedLine).not.toHaveProperty('IsWithholdingTaxCalculate');
    expect(postedLine).not.toHaveProperty('ISWITHHOLDINGTAXCALCULATE');

    expect(vendorPaymentJournalService.listLinesForHeader).toHaveBeenCalledWith(
      'JN000123',
      'USMF',
    );
    expect(
      vendorPaymentJournalService.updateLineFinancialTags,
    ).not.toHaveBeenCalled();
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
        offsetAccountDisplayValue: 'BANK001',
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
    expect(contract.Lines[1]).not.toHaveProperty('MarkedLines');
    // Scenario 4: a main account-only line carries no offset account, while the
    // vendor line in the same request keeps its own. The keys stay on the line
    // because the endpoint looks each one up and throws when it is missing.
    for (const offsetKey of [
      'offsetDEFAULTDIMENSIONDISPLAYVALUE',
      'offsetAccountDisplayValue',
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
    // accountTypeStr is lowercased, and only the documented rate / offset keys
    // are sent (no ExchRate / EXCHANGERATE / ReportingCurrencyExchRate aliases).
    expect(d365foClient.post.mock.calls[0][1]).toEqual({
      _contract: {
        Lines: [
          {
            ...documentedLine,
            journalNum: 'Mesco-000013758',
            accountTypeStr: 'vendor',
            VendorGroup: 'Custody',
          },
        ],
      },
    });
  });

  it('omits empty MarkedLines and duplicate exchange-rate aliases from the bulk body', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! JN-CLEAN',
    });

    await service.postCashOutLinesForHeader(
      'JN-CLEAN',
      [
        {
          LineNumber: 1,
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'RP-000007',
            accountTypeStr: 'Vendor',
            company: 'm-p',
            creditAmount: 0,
            currency: 'USD',
            debitAmount: 778,
            ExchRate: 4765,
            EXCHANGERATE: 4765,
            ExchangeRate: 4765,
            ReportingCurrencyExchRate: 100,
            ReportingExchangeRate: 100,
            REPORTINGEXCHANGERATE: 100,
            ExchRateSecond: 100,
            DEFAULTDIMENSIONDISPLAYVALUE: 'dims',
            FinTagStr: 'tags',
            ISPREPAYMENT: 'No',
            ITEMWITHHOLDINGTAXGROUP: '',
            IsWithholdingTaxCalculate: 'No',
            ISWITHHOLDINGTAXCALCULATE: 'No',
            MarkedLines: [],
            Voucher: '',
            VendorGroup: '',
            PAYMENTNOTES: 'MSC',
            TRANSACTIONTEXT: 'MSC',
          },
        } as any,
      ],
      20,
      'm-p',
    );

    const postedLine = d365foClient.post.mock.calls[0][1]._contract.Lines[0];
    expect(postedLine).toMatchObject({
      journalNum: 'JN-CLEAN',
      AccountNum: 'RP-000007',
      accountTypeStr: 'vendor',
      ExchangeRate: 4765,
      ReportingExchangeRate: 100,
      VendorGroup: '',
      offsetAccountDisplayValue: '',
      offsetDEFAULTDIMENSIONDISPLAYVALUE: '',
    });
    expect(postedLine).not.toHaveProperty('MarkedLines');
    expect(postedLine).not.toHaveProperty('ExchRate');
    expect(postedLine).not.toHaveProperty('EXCHANGERATE');
    expect(postedLine).not.toHaveProperty('ReportingCurrencyExchRate');
    expect(postedLine).not.toHaveProperty('REPORTINGEXCHANGERATE');
    expect(postedLine).not.toHaveProperty('ExchRateSecond');
    expect(postedLine).not.toHaveProperty('Voucher');
    expect(postedLine).not.toHaveProperty('IsWithholdingTaxCalculate');
    expect(postedLine).not.toHaveProperty('ISWITHHOLDINGTAXCALCULATE');
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

  it('retries a failed bulk line without marked settlements when its amount exceeds the remaining invoice amount', async () => {
    const { service, d365foClient } = buildService();

    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Error',
        Message:
          'The amount of the Invoice: 2025001409 is greater than the remain amount.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: 'Success! Mesco-000013709',
      });

    const result = await service.postCashOutLinesForHeader(
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
    );

    expect(result).toEqual([{ headerId: 'Mesco-000013709', lineNumber: 9 }]);
    expect(d365foClient.post).toHaveBeenCalledTimes(2);
    expect(d365foClient.post.mock.calls[0][1]._contract.Lines[0]).toMatchObject(
      {
        journalNum: 'Mesco-000013709',
        MarkedLines: [expect.objectContaining({ InvoiceNumber: '2025001409' })],
        PAYMENTNOTES: 'Vendor Payment - Freight Jan 2026 (Transfer)',
        TRANSACTIONTEXT: 'Vendor Payment - Freight Jan 2026 (Transfer)',
      },
    );
    expect(d365foClient.post.mock.calls[1][1]._contract.Lines[0]).toMatchObject(
      {
        journalNum: 'Mesco-000013709',
        PAYMENTNOTES: 'Vendor Payment - Freight Jan 2026 (Transfer) - unmarked',
        TRANSACTIONTEXT:
          'Vendor Payment - Freight Jan 2026 (Transfer) - unmarked',
      },
    );
    expect(
      d365foClient.post.mock.calls[1][1]._contract.Lines[0],
    ).not.toHaveProperty('MarkedLines');
  });

  it('retries every line unmarked when an all-or-nothing FO response reports remaining invoice amount', async () => {
    const { service, d365foClient } = buildService();

    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Error',
        Message:
          'The amount of the Invoice: 2025001409 is greater than the remaining amount.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: '2 line(s) processed successfully.',
      });

    await service.postCashOutLinesForHeader(
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
    );

    expect(d365foClient.post).toHaveBeenCalledTimes(2);
    expect(d365foClient.post.mock.calls[0][1]._contract.Lines).toHaveLength(2);
    expect(d365foClient.post.mock.calls[1][1]._contract.Lines).toEqual([
      expect.objectContaining({
        AccountNum: 'VEND1',
        PAYMENTNOTES: 'Pay 1 - unmarked',
      }),
      expect.objectContaining({
        AccountNum: 'VEND2',
        PAYMENTNOTES: 'Pay 2 - unmarked',
      }),
    ]);
    expect(
      d365foClient.post.mock.calls[1][1]._contract.Lines[0],
    ).not.toHaveProperty('MarkedLines');
    expect(
      d365foClient.post.mock.calls[1][1]._contract.Lines[1],
    ).not.toHaveProperty('MarkedLines');
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

  it('resumes cash-out from the first failed patch and skips already-posted FO lines', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();
    Object.defineProperty(service, 'cashOutBulkBatchSize', { value: 2 });

    vendorPaymentJournalService.listLinesForHeader.mockResolvedValue([
      { LineNumber: 1 },
      { LineNumber: 2 },
    ]);
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: '2 line(s) processed successfully.',
    });

    const result = await service.postCashOutLinesForHeader(
      'JN-RESUME',
      [
        {
          LineNumber: 1,
          customLineApiBody: { journalNum: '', AccountNum: 'VEND1' },
        } as any,
        {
          LineNumber: 2,
          customLineApiBody: { journalNum: '', AccountNum: 'VEND2' },
        } as any,
        {
          LineNumber: 3,
          customLineApiBody: { journalNum: '', AccountNum: 'VEND3' },
        } as any,
        {
          LineNumber: 4,
          customLineApiBody: { journalNum: '', AccountNum: 'VEND4' },
        } as any,
      ],
      20,
      'm-p',
    );

    expect(result).toEqual([
      { headerId: 'JN-RESUME', lineNumber: 1 },
      { headerId: 'JN-RESUME', lineNumber: 2 },
      { headerId: 'JN-RESUME', lineNumber: 3 },
      { headerId: 'JN-RESUME', lineNumber: 4 },
    ]);
    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(d365foClient.post.mock.calls[0][1]._contract.Lines).toEqual([
      expect.objectContaining({ AccountNum: 'VEND3', journalNum: 'JN-RESUME' }),
      expect.objectContaining({ AccountNum: 'VEND4', journalNum: 'JN-RESUME' }),
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
    expect(d365foClient.post.mock.calls[1][1]._contract).toMatchObject({
      MARKEDINVOICE: null,
      PAYMENTNOTES: 'DownPayment - Freight Jan 2026 - unmarked',
      TRANSACTIONTEXT: 'DownPayment - Freight Jan 2026 - unmarked',
    });
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
