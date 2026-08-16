import { CustomerPaymentJournalService } from './customer-payment-journal.service';
import { VendorInvoiceJournalService } from './vendor-invoice-journal.service';

describe('CustomerPaymentJournalService - cash custom line APIs', () => {
  function buildService() {
    const d365foClient = {
      post: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
      patch: jest.fn(),
    };

    const queryBuilder = {
      and: jest.fn((...parts: string[]) => parts.filter(Boolean).join(' and ')),
      or: jest.fn((...parts: string[]) => parts.filter(Boolean).join(' or ')),
      eq: jest.fn((field: string, value: string) => `${field} eq '${value}'`),
      contains: jest.fn(
        (field: string, value: string) => `contains(${field}, '${value}')`,
      ),
      buildQuery: jest.fn((path: string) => `${path}?$filter=probed`),
      buildFilterExpression: jest.fn((filters: string[]) =>
        filters.join(' and '),
      ),
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
      listIntegrityLinesForHeader: jest.fn().mockResolvedValue([]),
      updateLineFinancialTags: jest.fn().mockResolvedValue(undefined),
      deleteHeader: jest.fn().mockResolvedValue(undefined),
      deleteLine: jest.fn().mockResolvedValue(undefined),
      listSettledInvoicesForHeader: jest.fn().mockResolvedValue([]),
      listSettlementOwnersForInvoices: jest.fn().mockResolvedValue([]),
      listOpenInvoiceCandidatesForInvoices: jest.fn().mockResolvedValue([]),
      addSettledInvoice: jest.fn().mockResolvedValue(undefined),
      getHeaderIdentity: jest.fn().mockResolvedValue(null),
    };

    const vendorInvoiceJournalService = {
      findExistingInvoiceVendorPairInvoiceIds: jest
        .fn()
        .mockResolvedValue(new Map()),
    };

    const generalJournalService = {
      deleteJournalHeader: jest.fn().mockResolvedValue(undefined),
      deleteJournalLine: jest.fn().mockResolvedValue(undefined),
      getJournalLines: jest.fn().mockResolvedValue([]),
      getJournalHeaders: jest
        .fn()
        .mockResolvedValue([{ JournalBatchNumber: 'EXISTS' }]),
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
      get: jest.fn().mockReturnValue({ bulkHttpTimeout: 1_200_000 }),
    };

    const service = new CustomerPaymentJournalService(
      d365foClient as any,
      queryBuilder as any,
      retryService as any,
      dfoErrorExtractor as any,
      vendorInvoiceJournalService as any,
      vendorPaymentJournalService as any,
      generalJournalService as any,
      operationalLogs as any,
      logPayloads as any,
      configService as any,
    );

    return {
      service,
      d365foClient,
      vendorInvoiceJournalService,
      vendorPaymentJournalService,
      generalJournalService,
      operationalLogs,
      logPayloads,
    };
  }

  it('keeps extra Finance lines and does not roll them back', async () => {
    const { service, vendorPaymentJournalService } = buildService();
    const original = (lineNumber: number, invoice: string, amount: number) => ({
      LineNumber: lineNumber,
      AccountDisplayValue: 'RP-000003',
      AccountType: 'Vend',
      OffsetAccountDisplayValue: 'AlexSub EG',
      OffsetAccountType: 'RCash',
      CurrencyCode: 'EGP',
      DebitAmount: amount,
      CreditAmount: 0,
      PaymentId: '260196',
      PaymentReference: 'CashOut - ALEXSUB EG-295 - Fleet',
      MarkedInvoice: invoice,
      TransactionText: 'Vendor Payment - Fleet June 2026 (Cash)',
      FinTagDisplayValue: `TAG-${lineNumber}`,
      OffsetFinTagDisplayValue: 'OFFSET-TAG',
      PostingProfile: 'V-PP',
      TransactionDate: '2026-06-30T00:00:00Z',
    });
    const first = original(1, '106694', 18057.6);
    const second = original(2, '106407', 25080);
    vendorPaymentJournalService.listIntegrityLinesForHeader.mockResolvedValue([
      first,
      second,
      {
        ...first,
        LineNumber: 3,
        MarkedInvoice: '',
        TransactionText: `${first.TransactionText} unmarked with 106694`,
      },
      {
        ...second,
        LineNumber: 4,
        MarkedInvoice: '',
        TransactionText: `${second.TransactionText} unmarked with 106407`,
      },
    ]);
    vendorPaymentJournalService.listLinesForHeader.mockResolvedValue([
      { LineNumber: 1 },
      { LineNumber: 2 },
    ]);

    await expect(
      service.repairDuplicatedUnmarkedFallbackLines(
        'Mesco-000014745',
        2,
        'm-p',
      ),
    ).resolves.toBe(false);

    expect(vendorPaymentJournalService.deleteLine).not.toHaveBeenCalled();
  });

  it('keeps canonical line numbers when the two ranges are exact signature multisets', async () => {
    const { service, vendorPaymentJournalService } = buildService();
    const row = (
      lineNumber: number,
      account: string,
      paymentId: string,
      markedInvoice: string,
    ) => ({
      LineNumber: lineNumber,
      AccountDisplayValue: account,
      AccountType: 'Vend',
      OffsetAccountDisplayValue: 'PSD EG',
      OffsetAccountType: 'RCash',
      CurrencyCode: 'EGP',
      DebitAmount: 100,
      CreditAmount: 0,
      PaymentId: paymentId,
      PaymentReference: 'CashOut - PSD EG-203 - Freight',
      MarkedInvoice: markedInvoice,
      TransactionText: markedInvoice
        ? 'Vendor Payment - Freight'
        : 'Vendor Payment - Freight - unmarked',
      FinTagDisplayValue: `TAG-${paymentId}`,
      OffsetFinTagDisplayValue: `TAG-${paymentId}`,
      PostingProfile: 'V-PP',
      TransactionDate: '2026-03-01T00:00:00Z',
      SettleVoucher: markedInvoice ? 'SelectedTransact' : 'None',
    });
    // Interleaved: originals and unmarked copies are not a contiguous second half.
    vendorPaymentJournalService.listIntegrityLinesForHeader.mockResolvedValue([
      row(1, 'Tr-000031', '486738', '67'),
      row(2, 'Tr-000032', '486739', ''),
      row(3, 'Tr-000031', '486738', ''),
      row(4, 'Tr-000032', '486739', '68'),
    ]);
    vendorPaymentJournalService.listLinesForHeader.mockResolvedValue([
      { LineNumber: 1 },
      { LineNumber: 4 },
    ]);

    await expect(
      service.repairDuplicatedUnmarkedFallbackLines(
        'Mesco-000014781',
        2,
        'm-p',
      ),
    ).resolves.toBe(false);
    const deleted = vendorPaymentJournalService.deleteLine.mock.calls.map(
      (call: unknown[]) => call[1],
    );
    expect(deleted).toEqual([]);
  });

  it('repairs an exact twin range when legitimate source rows share a signature', async () => {
    const { service, vendorPaymentJournalService } = buildService();
    const row = (lineNumber: number, paymentId: string) => ({
      LineNumber: lineNumber,
      AccountDisplayValue: 'RP-000003',
      AccountType: 'Vend',
      OffsetAccountDisplayValue: 'PSD EG',
      OffsetAccountType: 'RCash',
      CurrencyCode: 'EGP',
      DebitAmount: 100,
      CreditAmount: 0,
      PaymentId: paymentId,
      PaymentReference: 'CashOut - PSD EG-203 - Freight',
      MarkedInvoice: lineNumber <= 3 ? `INV-${lineNumber}` : '',
      TransactionText: 'Vendor Payment - Freight - unmarked',
      FinTagDisplayValue: 'TAG',
      OffsetFinTagDisplayValue: 'TAG',
      PostingProfile: 'V-PP',
      TransactionDate: '2026-03-01T00:00:00Z',
    });
    vendorPaymentJournalService.listIntegrityLinesForHeader.mockResolvedValue([
      row(1, 'SAME'),
      row(2, 'SAME'),
      row(3, 'OTHER'),
      row(4, 'SAME'),
      row(5, 'SAME'),
      row(6, 'OTHER'),
    ]);
    vendorPaymentJournalService.listLinesForHeader.mockResolvedValue([
      { LineNumber: 1 },
      { LineNumber: 2 },
      { LineNumber: 3 },
    ]);

    await expect(
      service.repairDuplicatedUnmarkedFallbackLines(
        'Mesco-000014794',
        3,
        'm-p',
      ),
    ).resolves.toBe(false);
    expect(vendorPaymentJournalService.deleteLine).not.toHaveBeenCalled();
  });

  it('does not delete extra Finance rows that are not proven fallback twins', async () => {
    const { service, vendorPaymentJournalService } = buildService();
    vendorPaymentJournalService.listIntegrityLinesForHeader.mockResolvedValue([
      {
        LineNumber: 1,
        AccountDisplayValue: 'RP-000003',
        DebitAmount: 100,
        MarkedInvoice: 'INV-1',
        TransactionText: 'Original',
      },
      {
        LineNumber: 2,
        AccountDisplayValue: 'OTHER-VENDOR',
        DebitAmount: 100,
        MarkedInvoice: '',
        TransactionText: 'Original unmarked with INV-1',
      },
    ]);

    await expect(
      service.repairDuplicatedUnmarkedFallbackLines(
        'Mesco-000014745',
        1,
        'm-p',
      ),
    ).resolves.toBe(false);
    expect(vendorPaymentJournalService.deleteLine).not.toHaveBeenCalled();
  });

  it('deletes an exact rematch duplicate half when Finance returns 2× marked lines', async () => {
    const { service, vendorPaymentJournalService } = buildService();
    const row = (lineNumber: number) => ({
      LineNumber: lineNumber,
      AccountDisplayValue: 'Tr-000031',
      AccountType: 'Vend',
      OffsetAccountDisplayValue: 'PSD EG',
      OffsetAccountType: 'RCash',
      CurrencyCode: 'EGP',
      DebitAmount: 16623.48,
      CreditAmount: 0,
      PaymentId: '486738',
      PaymentReference: 'CashOut - PSD EG-203 - Freight',
      MarkedInvoice: '67',
      TransactionText: 'Vendor Payment - Freight March 2026 (Cash)',
      FinTagDisplayValue: 'O26-EXP-OC-1152|TAG',
      OffsetFinTagDisplayValue: 'O26-EXP-OC-1152|TAG',
      PostingProfile: 'V-PP',
      TransactionDate: '2026-03-01T00:00:00Z',
    });
    vendorPaymentJournalService.listIntegrityLinesForHeader.mockResolvedValue([
      row(1),
      row(2),
    ]);
    vendorPaymentJournalService.listLinesForHeader.mockResolvedValue([
      { LineNumber: 1 },
    ]);

    await expect(
      service.repairDuplicatedUnmarkedFallbackLines(
        'Mesco-000014781',
        1,
        'm-p',
      ),
    ).resolves.toBe(false);
    expect(vendorPaymentJournalService.deleteLine).not.toHaveBeenCalled();
  });

  it('keeps middleware unmarked-retry twins that use the - unmarked suffix', async () => {
    const { service, vendorPaymentJournalService } = buildService();
    const original = {
      LineNumber: 1,
      AccountDisplayValue: 'Tr-000031',
      AccountType: 'Vend',
      OffsetAccountDisplayValue: 'PSD EG',
      OffsetAccountType: 'RCash',
      CurrencyCode: 'EGP',
      DebitAmount: 100,
      CreditAmount: 0,
      PaymentId: '486738',
      PaymentReference: 'CashOut - PSD EG-203 - Freight',
      MarkedInvoice: '67',
      TransactionText: 'Vendor Payment - Freight March 2026 (Cash)',
      FinTagDisplayValue: 'TAG',
      OffsetFinTagDisplayValue: 'TAG',
      PostingProfile: 'V-PP',
      TransactionDate: '2026-03-01T00:00:00Z',
    };
    vendorPaymentJournalService.listIntegrityLinesForHeader.mockResolvedValue([
      original,
      {
        ...original,
        LineNumber: 2,
        MarkedInvoice: '',
        TransactionText: `${original.TransactionText} - unmarked`,
      },
    ]);
    vendorPaymentJournalService.listLinesForHeader.mockResolvedValue([
      { LineNumber: 1 },
    ]);

    await expect(
      service.repairDuplicatedUnmarkedFallbackLines(
        'Mesco-000014781',
        1,
        'm-p',
      ),
    ).resolves.toBe(false);
    expect(vendorPaymentJournalService.deleteLine).not.toHaveBeenCalled();
  });

  it('posts cash-in via addLedgerJournalTransCustPaym using the bulk Lines contract', async () => {
    const {
      service,
      d365foClient,
      vendorPaymentJournalService,
      operationalLogs,
    } = buildService();

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
    expect(body._contract).toHaveProperty('Lines');
    expect(body._contract.Lines).toHaveLength(1);
    const postedLine = body._contract.Lines[0];
    expect(postedLine).toHaveProperty('journalNum', 'JN000123');
    expect(postedLine).toHaveProperty('AccountNum', 'CUST001');
    expect(postedLine).toHaveProperty('accountTypeStr', 'cust');
    expect(postedLine).toHaveProperty('transDate', '2026-04-21T00:00:00');
    expect(postedLine).toHaveProperty('DocumentNum', 'DOC-1001');
    expect(postedLine).toHaveProperty('DocumentDate', '2026-04-20T00:00:00');
    expect(postedLine).toHaveProperty('MARKEDINVOICE', 'INV-0001');
    expect(postedLine).toHaveProperty('ExchangeRate', 100);
    expect(postedLine).not.toHaveProperty('EXCHANGERATE');
    expect(postedLine).not.toHaveProperty('ExchRate');
    expect(
      vendorPaymentJournalService.updateLineFinancialTags,
    ).not.toHaveBeenCalled();

    const events = operationalLogs.emit.mock.calls.map(
      ([event]: [any]) => event,
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'd365fo.cash-in.bulk-request',
          message: expect.stringContaining('Cash-in bulk request'),
        }),
        expect.objectContaining({
          eventType: 'd365fo.cash-in.bulk-response',
          message: expect.stringContaining('Cash-in bulk request'),
        }),
      ]),
    );
  });

  it('posts the exact D365 InvoiceId when source and Finance spaces differ', async () => {
    const { service, d365foClient, vendorInvoiceJournalService } =
      buildService();
    vendorInvoiceJournalService.findExistingInvoiceVendorPairInvoiceIds.mockResolvedValueOnce(
      new Map([
        [
          VendorInvoiceJournalService.pairKey('GDY_FV000005995 ', 'Ag-000194'),
          ' GDY_FV000005995',
        ],
      ]),
    );
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! Mesco-000014685',
    });

    await service.postCashOutLinesForHeader(
      'Mesco-000014685',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            company: 'm-p',
            AccountNum: 'Ag-000194',
            accountTypeStr: 'Vend',
            PAYMENTID: '486323',
            MarkedLines: [
              {
                InvoiceNumber: 'GDY_FV000005995 ',
                OperationNumber: '',
                DocumentNumber: '',
                HasWithHoldingLine: false,
              },
            ],
          },
        } as any,
      ],
      20,
      'm-p',
    );

    expect(
      d365foClient.post.mock.calls[0][1]._contract.Lines[0].MarkedLines[0]
        .InvoiceNumber,
    ).toBe(' GDY_FV000005995');
  });

  // Scenario 2: a single journal line still goes out inside Lines.
  it('resolves WCA USD/EUR aliases and retains Bank as the offset type', async () => {
    const { service, d365foClient } = buildService();

    d365foClient.get.mockResolvedValueOnce({
      value: [
        { MainAccountId: '125901', Name: 'WCApp - USD' },
        { MainAccountId: '125902', Name: ' WCApp - EUR' },
      ],
    });
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! JN-WCA',
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
          company: 'm-p',
          currency: 'USD',
          creditAmount: 0,
          debitAmount: 100,
          PAYMENTID: 'PAY-WCA-USD',
          offsetAccountDisplayValue: 'WCA-US',
          OffsetAccountTypeStr: 'Bank',
          offsetDEFAULTDIMENSIONDISPLAYVALUE: 'CC-001',
          ExchangeRate: 100,
        },
      },
      {
        dataAreaId: 'm-p',
        LineNumber: 2,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'VEND002',
          accountTypeStr: 'Vendor',
          company: 'm-p',
          currency: 'EUR',
          creditAmount: 0,
          debitAmount: 200,
          PAYMENTID: 'PAY-WCA-EUR',
          offsetAccountDisplayValue: 'WCA-EUR',
          OffsetAccountTypeStr: 'Bank',
          offsetDEFAULTDIMENSIONDISPLAYVALUE: 'CC-002',
          ExchangeRate: 100,
        },
      },
    ];

    await service.postCashOutLinesForHeader('JN-WCA', lines, 20, 'm-p');

    const [, body] = d365foClient.post.mock.calls[0];
    expect(body._contract.Lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          offsetAccountDisplayValue: '125901',
          OffsetAccountTypeStr: 'Bank',
        }),
        expect.objectContaining({
          offsetAccountDisplayValue: '125902',
          OffsetAccountTypeStr: 'Bank',
        }),
      ]),
    );
  });

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
    expect(options).toEqual({ timeout: 1_200_000, retries: 0 });
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
    expect(postedLine).toHaveProperty('transDate', '2026-04-21T00:00:00');
    expect(postedLine).toHaveProperty('ExchangeRate', 100);
    expect(postedLine).not.toHaveProperty('EXCHANGERATE');
    expect(postedLine).not.toHaveProperty('ExchRate');
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

  // FO rejects a ledger line that carries a sales tax group with
  // "An exchange rate cannot be found ... on exchange date .", so the groups
  // are stripped on insert and patched back onto the created line.
  it('posts ledger tax lines without their tax groups and patches the groups back', async () => {
    const { service, d365foClient } = buildService();

    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! JN000123',
    });
    // FO returns every line of the journal: the lookup cannot filter on
    // AccountType server side, so vendor and already taxed rows come back too.
    d365foClient.get.mockResolvedValueOnce({
      value: [
        {
          LineNumber: 6,
          AccountType: 'Vend',
          ItemSalesTaxGroup: '',
          PaymentId: 'PAY789',
          CurrencyCode: 'USD',
          DebitAmount: 298.68,
          CreditAmount: 0,
        },
        {
          LineNumber: 7,
          AccountType: 'Ledger',
          ItemSalesTaxGroup: '',
          PaymentId: 'PAY789',
          CurrencyCode: 'USD',
          DebitAmount: 0,
          CreditAmount: 7.86,
        },
        {
          LineNumber: 8,
          AccountType: 'Ledger',
          ItemSalesTaxGroup: 'VAT-14%',
          PaymentId: 'PAY789',
          CurrencyCode: 'USD',
          DebitAmount: 0,
          CreditAmount: 7.86,
        },
      ],
    });
    d365foClient.patch.mockResolvedValueOnce(undefined);

    const lines: any[] = [
      {
        dataAreaId: 'm-p',
        LineNumber: 1,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'Sl-000036',
          accountTypeStr: 'Vendor',
          company: 'm-p',
          currency: 'USD',
          creditAmount: 0,
          debitAmount: 298.68,
          PAYMENTID: 'PAY789',
          PostingProfile: 'V-PP',
          TaxGroup: 'Non-Taxabl',
          TAXITEMGROUP: '',
          ExchangeRate: 4765,
        },
      },
      {
        dataAreaId: 'm-p',
        LineNumber: 2,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: '223304|1301|013',
          accountTypeStr: 'ledger',
          company: 'm-p',
          currency: 'USD',
          creditAmount: 7.86,
          debitAmount: 0,
          PAYMENTID: 'PAY789',
          PostingProfile: '',
          TaxGroup: 'Taxable',
          TAXITEMGROUP: 'VAT-14%',
          ExchangeRate: 4765,
        },
      },
    ];

    await service.postCashOutLinesForHeader('JN000123', lines, 20, 'm-p');

    const [, body] = d365foClient.post.mock.calls[0];
    const [vendorLine, ledgerLine] = body._contract.Lines;
    expect(vendorLine).toHaveProperty('TaxGroup', 'Non-Taxabl');
    expect(ledgerLine).toHaveProperty('TaxGroup', '');
    expect(ledgerLine).toHaveProperty('TAXITEMGROUP', '');

    expect(d365foClient.patch).toHaveBeenCalledTimes(1);
    const [patchEndpoint, patchBody] = d365foClient.patch.mock.calls[0];
    expect(patchEndpoint).toContain(
      "/data/LedgerJournalLines(dataAreaId='m-p',JournalBatchNumber='JN000123',LineNumber=7)",
    );
    expect(patchBody).toEqual({
      SalesTaxGroup: 'Taxable',
      ItemSalesTaxGroup: 'VAT-14%',
    });
  });

  it('leaves lines untouched when no ledger line carries a tax group', async () => {
    const { service, d365foClient } = buildService();

    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: 'Success! JN000123',
    });

    const lines: any[] = [
      {
        dataAreaId: 'm-p',
        LineNumber: 1,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'Sl-000036',
          accountTypeStr: 'Vendor',
          company: 'm-p',
          currency: 'USD',
          creditAmount: 0,
          debitAmount: 100,
          PAYMENTID: 'PAY790',
          TaxGroup: 'Taxable',
          TAXITEMGROUP: 'VAT-14%',
          ExchangeRate: 4765,
        },
      },
    ];

    await service.postCashOutLinesForHeader('JN000123', lines, 20, 'm-p');

    const [, body] = d365foClient.post.mock.calls[0];
    expect(body._contract.Lines[0]).toHaveProperty('TAXITEMGROUP', 'VAT-14%');
    expect(d365foClient.patch).not.toHaveBeenCalled();
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
  // requests of at most 100 UniqueId groups each.
  it('splits a journal batch into requests of at most 100 UniqueId groups', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValue({
      StatusCode: 'Success',
      Message: 'Success! JN-250',
    });

    // 250 UniqueIds x 2 lines each -> 3 requests containing 100 + 100 + 50
    // complete groups (200 + 200 + 100 lines). This distinguishes the
    // required group-count limit from the old raw-line-count limit.
    const lines: any[] = Array.from({ length: 250 }, (_, index) => {
      const paymentId = `UID-${index + 1}`;
      return [
        {
          dataAreaId: 'm-p',
          LineNumber: index * 2 + 1,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: `VEND${index + 1}`,
            accountTypeStr: 'Vendor',
            debitAmount: 100,
            PAYMENTID: paymentId,
          },
        },
        {
          dataAreaId: 'm-p',
          LineNumber: index * 2 + 2,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: `OFFSET${index + 1}`,
            accountTypeStr: 'Ledger',
            creditAmount: 100,
            PAYMENTID: paymentId,
          },
        },
      ];
    }).flat();

    const result = await service.postCashOutLinesForHeader(
      'JN-250',
      lines,
      20,
      'm-p',
    );

    expect(result).toHaveLength(500);
    expect(d365foClient.post).toHaveBeenCalledTimes(3);
    const lineCounts = d365foClient.post.mock.calls.map(
      ([, body]: [string, any]) => body._contract.Lines.length,
    );
    expect(lineCounts).toEqual([200, 200, 100]);
    const uniqueIdCounts = d365foClient.post.mock.calls.map(
      ([, body]: [string, any]) =>
        new Set(body._contract.Lines.map((line: any) => line.PAYMENTID)).size,
    );
    expect(uniqueIdCounts).toEqual([100, 100, 50]);
    // Every line is sent exactly once, in order, and stays on its journal.
    const sentAccounts = d365foClient.post.mock.calls.flatMap(
      ([, body]: [string, any]) =>
        body._contract.Lines.map((line: any) => line.AccountNum),
    );
    expect(sentAccounts).toEqual(
      lines.map((line) => line.customLineApiBody.AccountNum),
    );
  });

  it('keeps every UniqueId group intact inside one bulk request', async () => {
    const { service, d365foClient } = buildService();
    Object.defineProperty(service, 'cashOutBulkBatchSize', { value: 2 });
    d365foClient.post.mockResolvedValue({
      StatusCode: 'Success',
      Message: 'Success! JN-GROUPS',
    });

    // 3 UniqueIds with 2 lines each. With max 2 groups/request:
    // request 1 = UID-A + UID-B (4 lines), request 2 = UID-C (2 lines).
    // Never split a UniqueId across requests even though line-count chunking
    // of size 2 would have broken UID-A / UID-B mid-group.
    const lines: any[] = [
      {
        LineNumber: 1,
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'VEND-A1',
          PAYMENTID: 'UID-A',
        },
      },
      {
        LineNumber: 2,
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'LEDGER-A2',
          PAYMENTID: 'UID-A',
        },
      },
      {
        LineNumber: 3,
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'VEND-B1',
          PAYMENTID: 'UID-B',
        },
      },
      {
        LineNumber: 4,
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'LEDGER-B2',
          PAYMENTID: 'UID-B',
        },
      },
      {
        LineNumber: 5,
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'VEND-C1',
          PAYMENTID: 'UID-C',
        },
      },
      {
        LineNumber: 6,
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'LEDGER-C2',
          PAYMENTID: 'UID-C',
        },
      },
    ];

    await service.postCashOutLinesForHeader('JN-GROUPS', lines, 20, 'm-p');

    expect(d365foClient.post).toHaveBeenCalledTimes(2);
    const paymentIdSets = d365foClient.post.mock.calls.map(
      ([, body]: [string, any]) =>
        [
          ...new Set(body._contract.Lines.map((line: any) => line.PAYMENTID)),
        ].sort(),
    );
    expect(paymentIdSets).toEqual([['UID-A', 'UID-B'], ['UID-C']]);
    expect(
      d365foClient.post.mock.calls.map(
        ([, body]: [string, any]) => body._contract.Lines.length,
      ),
    ).toEqual([4, 2]);
  });

  it('repairs a partial UniqueId group before resuming cash-out', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();
    vendorPaymentJournalService.listLinesForHeader.mockResolvedValueOnce([
      { LineNumber: 1 },
    ]);
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Success',
      Message: '2 line(s) processed successfully.',
    });

    await service.postCashOutLinesForHeader(
      'JN-PARTIAL',
      [
        {
          LineNumber: 1,
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'VEND-A',
            PAYMENTID: 'UID-A',
          },
        },
        {
          LineNumber: 2,
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'OFFSET-A',
            PAYMENTID: 'UID-A',
          },
        },
      ] as any[],
      20,
      'm-p',
    );

    expect(vendorPaymentJournalService.deleteLine).not.toHaveBeenCalled();
    expect(d365foClient.post).not.toHaveBeenCalled();
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
      ExchangeRate: 100,
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
    // accountTypeStr is lowercased, dates stay `yyyy-MM-ddT00:00:00` for FO
    // FormJsonSerializer, and ExchangeRate + ReportingExchangeRate are present.
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
    expect(
      d365foClient.post.mock.calls[0][1]._contract.Lines[0],
    ).toHaveProperty('ExchangeRate', 100);
  });

  it('keeps ExchangeRate/ReportingExchangeRate and omits empty MarkedLines plus rate aliases', async () => {
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
    expect(postedLine).not.toHaveProperty('EXCHANGERATE');
    expect(postedLine).not.toHaveProperty('ExchRate');
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

  it('keeps MarkedLines on the FO body and does not strip settlement after an invoice remaining-amount error', async () => {
    const { service, d365foClient } = buildService();

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
    ).rejects.toThrow(/greater than the remain amount/i);

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(d365foClient.post.mock.calls[0][1]._contract.Lines[0]).toMatchObject(
      {
        journalNum: 'Mesco-000013709',
        MarkedLines: [expect.objectContaining({ InvoiceNumber: '2025001409' })],
        PAYMENTNOTES: 'Vendor Payment - Freight Jan 2026 (Transfer)',
        TRANSACTIONTEXT: 'Vendor Payment - Freight Jan 2026 (Transfer)',
      },
    );
  });

  it('does not unmarked-retry a marked UniqueId group when FO reports remaining invoice amount', async () => {
    const { service, d365foClient } = buildService();

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
    ).rejects.toThrow(/greater than the remaining amount/i);

    expect(d365foClient.post).toHaveBeenCalledTimes(1);
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

  it('does not retry only the failed part of one UniqueId group', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValueOnce({
      StatusCode: 'Error',
      Lines: [
        { LineNumber: 1, Success: true },
        {
          LineNumber: 2,
          Success: false,
          Message:
            'The amount of the Invoice: INV-2 is greater than the remaining amount.',
        },
      ],
    });

    await expect(
      service.postCashOutLinesForHeader(
        'JN-PARTIAL-RETRY',
        [
          {
            LineNumber: 1,
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'VEND-A',
              PAYMENTID: 'UID-A',
            },
          },
          {
            LineNumber: 2,
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'OFFSET-A',
              PAYMENTID: 'UID-A',
              MarkedLines: [{ InvoiceNumber: 'INV-2' }],
            },
          },
        ] as any[],
        20,
        'm-p',
      ),
    ).rejects.toThrow(/greater than the remaining amount/i);

    // Settlement marks stay on the failed FO body — no unmarked split-retry.
    expect(d365foClient.post).toHaveBeenCalledTimes(1);
    expect(
      d365foClient.post.mock.calls[0][1]._contract.Lines[1],
    ).toHaveProperty('MarkedLines', [
      expect.objectContaining({ InvoiceNumber: 'INV-2' }),
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

  it('resumes cash-out from the first failed UniqueId-group patch and skips already-posted FO lines', async () => {
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
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'VEND1',
            PAYMENTID: 'UID-1',
          },
        } as any,
        {
          LineNumber: 2,
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'VEND2',
            PAYMENTID: 'UID-2',
          },
        } as any,
        {
          LineNumber: 3,
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'VEND3',
            PAYMENTID: 'UID-3',
          },
        } as any,
        {
          LineNumber: 4,
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'VEND4',
            PAYMENTID: 'UID-4',
          },
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
      expect.objectContaining({
        AccountNum: 'VEND3',
        journalNum: 'JN-RESUME',
        PAYMENTID: 'UID-3',
      }),
      expect.objectContaining({
        AccountNum: 'VEND4',
        journalNum: 'JN-RESUME',
        PAYMENTID: 'UID-4',
      }),
    ]);
  });

  it('clears the blocking journal then rematches when FO reports already marked for settlement', async () => {
    const {
      service,
      d365foClient,
      generalJournalService,
      vendorPaymentJournalService,
    } = buildService();

    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Failed',
        Message:
          'This transaction has been marked for settlement by Custody Settlement Mesco-000014128 in company m-p.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: 'Success! Mesco-000014129',
      });

    const result = await service.postCashOutLinesForHeader(
      'Mesco-000014129',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            MarkedLines: [
              {
                InvoiceNumber: '',
                OperationNumber: 'OP-1',
                DocumentNumber: 'DOC-1',
                HasWithHoldingLine: false,
              },
            ],
            PAYMENTNOTES: 'Custody Settlement',
            TRANSACTIONTEXT: 'Custody Settlement',
          },
        } as any,
      ],
      20,
      'm-p',
    );

    expect(result).toEqual([{ headerId: 'Mesco-000014129', lineNumber: 1 }]);
    expect(generalJournalService.deleteJournalHeader).not.toHaveBeenCalled();
    expect(vendorPaymentJournalService.deleteHeader).not.toHaveBeenCalled();
    expect(d365foClient.post).toHaveBeenCalledTimes(2);
    expect(d365foClient.post.mock.calls[1][1]._contract.Lines[0]).toMatchObject(
      {
        journalNum: 'Mesco-000014129',
        MarkedLines: [expect.objectContaining({ DocumentNumber: 'DOC-1' })],
        PAYMENTNOTES: 'Custody Settlement',
      },
    );
  });

  it('keeps the self-cited journal and rematches missing lines without rollback', async () => {
    const {
      service,
      d365foClient,
      generalJournalService,
      vendorPaymentJournalService,
    } = buildService();

    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Failed',
        Message:
          'This transaction has been marked for settlement by Vendor Payment Freight Mesco-000014382 in company m-p.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: 'Success! Mesco-000014382',
      });

    await expect(
      service.postCashOutLinesForHeader(
        'Mesco-000014382',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 1,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              company: 'm-p',
              DocumentNum: 'INV-1',
              MarkedLines: [
                {
                  InvoiceNumber: 'INV-1',
                  OperationNumber: '',
                  DocumentNumber: '',
                  HasWithHoldingLine: false,
                },
              ],
              PAYMENTNOTES: 'Vendor Payment - Freight January 2026 (Transfer)',
              TRANSACTIONTEXT:
                'Vendor Payment - Freight January 2026 (Transfer)',
            },
          } as any,
        ],
        20,
        'm-p',
      ),
    ).resolves.toEqual([{ headerId: 'Mesco-000014382', lineNumber: 1 }]);

    expect(generalJournalService.deleteJournalHeader).not.toHaveBeenCalled();
    expect(vendorPaymentJournalService.deleteHeader).not.toHaveBeenCalled();
    expect(vendorPaymentJournalService.deleteLine).not.toHaveBeenCalled();
    expect(d365foClient.post).toHaveBeenCalledTimes(2);
  });

  it('keeps earlier accepted patches when a later patch self-cites SpecTrans', async () => {
    const {
      service,
      d365foClient,
      generalJournalService,
      vendorPaymentJournalService,
    } = buildService();
    Object.defineProperty(service, 'cashOutBulkBatchSize', { value: 1 });

    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: '1 line(s) processed successfully.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Failed',
        Message:
          'This transaction has been marked for settlement by Vendor Payment Freight JN-KEEP in company m-p.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: '1 line(s) processed successfully.',
      });

    await service.postCashOutLinesForHeader(
      'JN-KEEP',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            company: 'm-p',
            AccountNum: 'VEND-1',
            PAYMENTID: 'UID-1',
            MarkedLines: [{ InvoiceNumber: 'INV-1' }],
          },
        } as any,
        {
          dataAreaId: 'm-p',
          LineNumber: 2,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            company: 'm-p',
            AccountNum: 'VEND-2',
            PAYMENTID: 'UID-2',
            MarkedLines: [{ InvoiceNumber: 'INV-2' }],
          },
        } as any,
      ],
      20,
      'm-p',
    );

    expect(generalJournalService.deleteJournalHeader).not.toHaveBeenCalled();
    expect(vendorPaymentJournalService.deleteHeader).not.toHaveBeenCalled();
    expect(d365foClient.post).toHaveBeenCalledTimes(3);
    expect(
      d365foClient.post.mock.calls.map(
        ([, body]: [string, any]) => body._contract.Lines[0].PAYMENTID,
      ),
    ).toEqual(['UID-1', 'UID-2', 'UID-2']);
  });

  it('strips MarkedLines already settled by an earlier accepted patch before posting the next patch', async () => {
    const { service, d365foClient } = buildService();
    Object.defineProperty(service, 'cashOutBulkBatchSize', { value: 1 });
    d365foClient.post.mockResolvedValue({
      StatusCode: 'Success',
      Message: 'ok',
    });

    await service.postCashOutLinesForHeader(
      'JN-DEDUP',
      [
        {
          LineNumber: 1,
          customLineApiBody: {
            journalNum: '',
            company: 'm-p',
            AccountNum: 'VEND-1',
            PAYMENTID: 'UID-1',
            MarkedLines: [{ InvoiceNumber: 'INV-SHARED' }],
          },
        } as any,
        {
          LineNumber: 2,
          customLineApiBody: {
            journalNum: '',
            company: 'm-p',
            AccountNum: 'VEND-2',
            PAYMENTID: 'UID-2',
            MarkedLines: [
              { InvoiceNumber: 'INV-SHARED' },
              { InvoiceNumber: 'INV-ONLY-2' },
            ],
          },
        } as any,
      ],
      20,
      'm-p',
    );

    expect(d365foClient.post).toHaveBeenCalledTimes(2);
    expect(
      d365foClient.post.mock.calls[1][1]._contract.Lines[0].MarkedLines,
    ).toEqual([expect.objectContaining({ InvoiceNumber: 'INV-ONLY-2' })]);
  });

  it('preserves DocumentNum on invoice-marked Vendor Payment lines from the input line', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValue({
      StatusCode: 'Success',
      Message: 'ok',
    });

    await service.postCashOutLinesForHeader(
      'JN-DOC',
      [
        {
          LineNumber: 1,
          customLineApiBody: {
            journalNum: '',
            company: 'm-p',
            AccountNum: 'VEND-1',
            PAYMENTID: 'UID-1',
            DocumentNum: '17607',
            MarkedLines: [{ InvoiceNumber: '67' }],
          },
        } as any,
        {
          LineNumber: 2,
          customLineApiBody: {
            journalNum: '',
            company: 'm-p',
            AccountNum: 'VEND-2',
            PAYMENTID: 'UID-1',
            DocumentNum: '17607',
            MarkedLines: [{ InvoiceNumber: '68' }],
          },
        } as any,
      ],
      20,
      'm-p',
    );

    const posted = d365foClient.post.mock.calls[0][1]._contract.Lines;
    expect(posted).toHaveLength(2);
    expect(posted.every((line: any) => line.DocumentNum === '17607')).toBe(true);
    expect(
      posted.map((line: any) => line.MarkedLines[0].InvoiceNumber),
    ).toEqual(['67', '68']);
  });

  it('preserves MarkedLines and DocumentNum on paired 223304 withholding companion lines', async () => {
    const { service, d365foClient } = buildService();
    d365foClient.post.mockResolvedValue({
      StatusCode: 'Success',
      Message: 'ok',
    });

    await service.postCashOutLinesForHeader(
      'Mesco-000014853',
      [
        {
          LineNumber: 1,
          customLineApiBody: {
            journalNum: '',
            company: 'm-p',
            AccountNum: 'Tr-000031',
            accountTypeStr: 'Vendor',
            PAYMENTID: '496578',
            DocumentNum: '18369',
            debitAmount: 13440.47,
            offsetAccountDisplayValue: 'PSD EG',
            OffsetAccountTypeStr: 'RCash',
            VendorGroup: 'Truckers',
            MarkedLines: [
              {
                InvoiceNumber: '120',
                OperationNumber: 'O26-EXP-OC-1759',
                DocumentNumber: '',
                HasWithHoldingLine: true,
              },
            ],
          },
        } as any,
        {
          LineNumber: 2,
          customLineApiBody: {
            journalNum: '',
            company: 'm-p',
            AccountNum: 'Tr-000031',
            accountTypeStr: 'Vendor',
            PAYMENTID: '496578',
            DocumentNum: '18369',
            debitAmount: 358.08,
            offsetAccountDisplayValue: '223304|1201|012|001|005',
            OffsetAccountTypeStr: 'Ledger',
            VendorGroup: 'Truckers',
            MarkedLines: [
              {
                InvoiceNumber: '120',
                OperationNumber: 'O26-EXP-OC-1759',
                DocumentNumber: '',
                HasWithHoldingLine: true,
              },
            ],
          },
        } as any,
      ],
      20,
      'm-p',
    );

    const posted = d365foClient.post.mock.calls[0][1]._contract.Lines;
    expect(posted).toHaveLength(2);
    // Both lines must keep their invoice mark for invoice 120
    expect(posted[0].MarkedLines).toEqual([
      expect.objectContaining({
        InvoiceNumber: '120',
        OperationNumber: 'O26-EXP-OC-1759',
        DocumentNumber: '',
        HasWithHoldingLine: true,
      }),
    ]);
    expect(posted[1].MarkedLines).toEqual([
      expect.objectContaining({
        InvoiceNumber: '120',
        OperationNumber: 'O26-EXP-OC-1759',
        DocumentNumber: '',
        HasWithHoldingLine: true,
      }),
    ]);
    // Both lines must preserve DocumentNum from the input line
    expect(posted[0].DocumentNum).toBe('18369');
    expect(posted[1].DocumentNum).toBe('18369');
    expect(posted[1].offsetAccountDisplayValue).toContain('223304');
  });

  it('keeps self-cited vendor payment lines and rematches without deleting the journal', async () => {
    const {
      service,
      d365foClient,
      generalJournalService,
      vendorPaymentJournalService,
    } = buildService();
    generalJournalService.getJournalHeaders.mockResolvedValue([]);
    d365foClient.get.mockResolvedValue({
      value: [{ JournalBatchNumber: 'Mesco-000014718' }],
    });
    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Failed',
        Message:
          'This transaction has been marked for settlement by Vendor Payment Freight Mesco-000014718 in company m-p.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: 'Success! Mesco-000014718',
      });

    await expect(
      service.postCashOutLinesForHeader(
        'Mesco-000014718',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 1,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              company: 'm-p',
              AccountNum: 'VEND-1',
              MarkedLines: [{ InvoiceNumber: 'INV-1' }],
            },
          } as any,
        ],
        20,
        'm-p',
      ),
    ).resolves.toEqual([{ headerId: 'Mesco-000014718', lineNumber: 1 }]);

    expect(vendorPaymentJournalService.deleteLine).not.toHaveBeenCalled();
    expect(vendorPaymentJournalService.deleteHeader).not.toHaveBeenCalled();
  });

  it('stops retry recreation when dependent-line cleanup fails', async () => {
    const {
      service,
      d365foClient,
      generalJournalService,
      vendorPaymentJournalService,
    } = buildService();
    generalJournalService.getJournalHeaders.mockResolvedValue([]);
    d365foClient.get.mockResolvedValue({
      value: [{ JournalBatchNumber: 'Mesco-000014718' }],
    });
    vendorPaymentJournalService.listLinesForHeader
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ LineNumber: 1 }]);
    vendorPaymentJournalService.deleteLine.mockRejectedValueOnce(
      new Error('line is locked'),
    );
    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Failed',
        Message:
          'This transaction has been marked for settlement by Vendor Payment Freight Mesco-000014718 in company m-p.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: 'Success! Mesco-000014718',
      });

    await expect(
      service.postCashOutLinesForHeader(
        'Mesco-000014718',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 1,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              company: 'm-p',
              AccountNum: 'VEND-1',
              MarkedLines: [{ InvoiceNumber: 'INV-1' }],
            },
          } as any,
        ],
        20,
        'm-p',
      ),
    ).resolves.toEqual([{ headerId: 'Mesco-000014718', lineNumber: 1 }]);

    expect(vendorPaymentJournalService.deleteHeader).not.toHaveBeenCalled();
    expect(vendorPaymentJournalService.deleteLine).not.toHaveBeenCalled();
  });

  it('posts unmarked when SpecTrans cites the current journal but lines have no settlement marks', async () => {
    const {
      service,
      d365foClient,
      generalJournalService,
      vendorPaymentJournalService,
    } = buildService();

    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Failed',
        Message:
          'This transaction has been marked for settlement by Custody Settlement Mesco-000014130 in company m-p.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: 'Success! Mesco-000014130',
      });

    const result = await service.postCashOutLinesForHeader(
      'Mesco-000014130',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            company: 'm-p',
            DocumentNum: '',
            PAYMENTNOTES: 'Custody Settlement',
            TRANSACTIONTEXT: 'Custody Settlement',
          },
        } as any,
      ],
      20,
      'm-p',
    );

    expect(result).toEqual([{ headerId: 'Mesco-000014130', lineNumber: 1 }]);
    expect(generalJournalService.deleteJournalHeader).not.toHaveBeenCalled();
    expect(vendorPaymentJournalService.deleteHeader).not.toHaveBeenCalled();
    expect(d365foClient.post).toHaveBeenCalledTimes(2);
    expect(d365foClient.post.mock.calls[1][1]._contract.Lines[0]).toMatchObject(
      {
        journalNum: 'Mesco-000014130',
        DocumentNum: '',
        PAYMENTNOTES: 'Custody Settlement',
      },
    );
  });

  it('skips DELETE when the SpecTrans journal no longer exists in FO', async () => {
    const {
      service,
      d365foClient,
      generalJournalService,
      vendorPaymentJournalService,
    } = buildService();

    generalJournalService.getJournalHeaders.mockResolvedValue([]);
    d365foClient.get.mockResolvedValue({ value: [] });

    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Failed',
        Message:
          'This transaction has been marked for settlement by Custody Settlement Mesco-000014128 in company m-p.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Failed',
        Message:
          'This transaction has been marked for settlement by Custody Settlement Mesco-000014128 in company m-p.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: 'Success! Mesco-000014129',
      });

    await service.postCashOutLinesForHeader(
      'Mesco-000014129',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            DocumentNum: 'DOC-1',
            MarkedLines: [
              {
                InvoiceNumber: '',
                OperationNumber: 'OP-1',
                DocumentNumber: 'DOC-1',
                HasWithHoldingLine: false,
              },
            ],
            PAYMENTNOTES: 'Custody Settlement',
            TRANSACTIONTEXT: 'Custody Settlement',
          },
        } as any,
      ],
      20,
      'm-p',
    );

    expect(generalJournalService.deleteJournalHeader).not.toHaveBeenCalled();
    expect(vendorPaymentJournalService.deleteHeader).not.toHaveBeenCalled();
    expect(d365foClient.post.mock.calls[2][1]._contract.Lines[0]).toMatchObject(
      {
        DocumentNum: '',
        PAYMENTNOTES: 'Custody Settlement - unmarked',
      },
    );
  });

  it('falls back to unmarked retry when settlement marks remain after clearing the cited journal', async () => {
    const { service, d365foClient, generalJournalService } = buildService();

    // Probe says journal exists, but DELETE is a no-op race (already removed).
    generalJournalService.deleteJournalHeader.mockRejectedValueOnce(
      new Error('No resources were found when selecting for update.'),
    );

    d365foClient.post
      .mockResolvedValueOnce({
        StatusCode: 'Failed',
        Message:
          'This transaction has been marked for settlement by Custody Settlement Mesco-000014128 in company m-p.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Failed',
        Message:
          'This transaction has been marked for settlement by Custody Settlement Mesco-000014128 in company m-p.',
      })
      .mockResolvedValueOnce({
        StatusCode: 'Success',
        Message: 'Success! Mesco-000014129',
      });

    const result = await service.postCashOutLinesForHeader(
      'Mesco-000014129',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            DocumentNum: 'DOC-1',
            MarkedLines: [
              {
                InvoiceNumber: '',
                OperationNumber: 'OP-1',
                DocumentNumber: 'DOC-1',
                HasWithHoldingLine: false,
              },
            ],
            PAYMENTNOTES: 'Custody Settlement',
            TRANSACTIONTEXT: 'Custody Settlement',
          },
        } as any,
      ],
      20,
      'm-p',
    );

    expect(result).toEqual([{ headerId: 'Mesco-000014129', lineNumber: 1 }]);
    expect(d365foClient.post).toHaveBeenCalledTimes(3);
    expect(d365foClient.post.mock.calls[2][1]._contract.Lines[0]).toMatchObject(
      {
        journalNum: 'Mesco-000014129',
        DocumentNum: '',
        PAYMENTNOTES: 'Custody Settlement - unmarked',
      },
    );
    expect(
      d365foClient.post.mock.calls[2][1]._contract.Lines[0],
    ).not.toHaveProperty('MarkedLines');
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

  it('defers an ambiguous duplicate invoice mark until exact settlement repair', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();
    vendorPaymentJournalService.listOpenInvoiceCandidatesForInvoices.mockResolvedValue(
      [
        {
          Invoice: '102260',
          AccountNum: 'RP-000003',
          AmountCur: -19248.9,
          SettleAmountCur: 0,
          CurrencyCode: 'EGP',
          DueDate: '2025-12-21T12:00:00Z',
          Closed: '1900-01-01T12:00:00Z',
        },
        {
          Invoice: '102260',
          AccountNum: 'RP-000003',
          AmountCur: -19562.4,
          SettleAmountCur: 0,
          CurrencyCode: 'EGP',
          DueDate: '2026-04-22T12:00:00Z',
          Closed: '1900-01-01T12:00:00Z',
        },
      ],
    );
    d365foClient.post.mockResolvedValue({
      StatusCode: 'Success',
      Message: 'Success! JN-DUP-INV',
    });

    await service.postCashOutLinesForHeader(
      'JN-DUP-INV',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 50,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'RP-000003',
            accountTypeStr: 'Vendor',
            currency: 'EGP',
            debitAmount: 19562.4,
            creditAmount: 0,
            MarkedLines: [{ InvoiceNumber: '102260' }],
          },
        } as any,
      ],
      20,
      'm-p',
    );

    expect(
      d365foClient.post.mock.calls[0][1]._contract.Lines[0],
    ).not.toHaveProperty('MarkedLines');
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
        MARKEDINVOICE: null,
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

  it('fails when another journal owns the invoice mark', async () => {
    const { service, vendorPaymentJournalService } = buildService();
    vendorPaymentJournalService.listSettlementOwnersForInvoices.mockResolvedValue(
      [
        {
          JournalLineCompany: 'm-p',
          JournalBatchNumber: 'Mesco-000014711',
          JournalLineNumber: 133,
          InvoiceNumber: '106551',
          InvoiceCompany: 'm-p',
          invoiceAccount: 'RP-000003',
        },
      ],
    );

    await expect(
      service.assertCashOutSettlementIntegrity(
        'Mesco-000014745',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 16,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'RP-000003',
              currency: 'EGP',
              debitAmount: 34610.4,
              creditAmount: 0,
              MarkedLines: [{ InvoiceNumber: '106551' }],
            },
          } as any,
        ],
        'm-p',
      ),
    ).rejects.toThrow('already marked by Mesco-000014711');

    expect(
      vendorPaymentJournalService.addSettledInvoice,
    ).not.toHaveBeenCalled();
    expect(vendorPaymentJournalService.deleteHeader).not.toHaveBeenCalled();
  });

  it('stops before header creation when the requested invoice is no longer open', async () => {
    const { service, vendorPaymentJournalService } = buildService();
    vendorPaymentJournalService.listOpenInvoiceCandidatesForInvoices.mockResolvedValue(
      [
        {
          Invoice: '39084/2',
          AccountNum: 'RP-000003',
          AmountCur: -95,
          SettleAmountCur: -95,
          CurrencyCode: 'USD',
          DueDate: '2026-03-14T12:00:00Z',
          Closed: '2026-08-16T12:00:00Z',
        },
      ],
    );

    await expect(
      service.assertNoExternalSettlementOwners(
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 1,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'RP-000003',
              currency: 'USD',
              debitAmount: 95,
              creditAmount: 0,
              MarkedLines: [{ InvoiceNumber: '39084/2' }],
            },
          } as any,
        ],
        'm-p',
      ),
    ).rejects.toThrow('no longer available for payment');

    expect(
      vendorPaymentJournalService.addSettledInvoice,
    ).not.toHaveBeenCalled();
  });

  it('fails when another journal owns the silent mark conflict', async () => {
    const { service } = buildService();
    const expectedLine = {
      dataAreaId: 'm-p',
      LineNumber: 93,
      cashDirection: 'out',
      customLineApiBody: {
        journalNum: '',
        AccountNum: 'V-001',
        currency: 'EGP',
        debitAmount: 100,
        creditAmount: 0,
        MarkedLines: [{ InvoiceNumber: '5389' }],
      },
    } as any;
    const firstResult = {
      matches: false,
      expectedCount: 1,
      actualCount: 0,
      missing: [
        {
          lineNumber: 93,
          invoiceNumber: '5389',
          vendorAccount: 'V-001',
          currency: 'EGP',
          settlementAmount: -100,
        },
      ],
      unexpected: [],
      blockers: [
        {
          expectedLineNumber: 93,
          invoiceNumber: '5389',
          journalBatchNumber: 'Mesco-000014793',
          journalLineNumber: 93,
          journalLineCompany: 'm-p',
        },
      ],
      repaired: [],
      repairErrors: [],
    };
    const secondResult = {
      ...firstResult,
      matches: true,
      actualCount: 1,
      missing: [],
      blockers: [],
    };
    const verify = jest
      .spyOn(service, 'verifyCashOutSettlementIntegrity')
      .mockResolvedValueOnce(firstResult)
      .mockResolvedValueOnce(secondResult);
    const deleteBlocker = jest
      .spyOn(service as any, 'tryDeleteBlockingJournalHeader')
      .mockResolvedValue(true);

    await expect(
      service.assertCashOutSettlementIntegrity(
        'Mesco-000014702',
        [expectedLine],
        'm-p',
      ),
    ).rejects.toThrow('invoice settlement mismatch');

    expect(deleteBlocker).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('does not delete a posted journal that owns a settlement mark', async () => {
    const { service, vendorPaymentJournalService } = buildService();
    vendorPaymentJournalService.getHeaderIdentity.mockResolvedValue({
      JournalBatchNumber: 'Mesco-000014793',
      IsPosted: 'Yes',
    });

    await expect(
      (service as any).tryDeleteBlockingJournalHeader('m-p', 'Mesco-000014793'),
    ).resolves.toBe(false);
    expect(vendorPaymentJournalService.deleteHeader).not.toHaveBeenCalled();
  });

  it('repairs only the missing settlement child record when the invoice is available', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();
    vendorPaymentJournalService.listIntegrityLinesForHeader.mockResolvedValue([
      {
        LineNumber: 16,
        AccountDisplayValue: 'RP-000003',
        DebitAmount: 34610.4,
        CreditAmount: 0,
        MarkedInvoice: '',
      },
    ]);
    vendorPaymentJournalService.listSettledInvoicesForHeader
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          JournalLineCompany: 'm-p',
          JournalBatchNumber: 'Mesco-000014745',
          JournalLineNumber: 16,
          InvoiceNumber: '106551',
          InvoiceCompany: 'm-p',
        },
      ]);
    d365foClient.get.mockResolvedValue({
      value: [
        {
          Invoice: '106551',
          AccountNum: 'RP-000003',
          AmountCur: -34000,
          SettleAmountCur: 0,
          CurrencyCode: 'EGP',
          DueDate: '2025-12-21T12:00:00Z',
          Closed: '1900-01-01T12:00:00Z',
        },
        {
          Invoice: '106551',
          AccountNum: 'RP-000003',
          AmountCur: -34610.4,
          SettleAmountCur: 0,
          CurrencyCode: 'EGP',
          DueDate: '2026-04-30T12:00:00Z',
          Closed: '1900-01-01T12:00:00Z',
        },
      ],
    });

    await expect(
      service.assertCashOutSettlementIntegrity(
        'Mesco-000014745',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 16,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'RP-000003',
              currency: 'EGP',
              debitAmount: 34610.4,
              creditAmount: 0,
              MarkedLines: [{ InvoiceNumber: '106551' }],
            },
          } as any,
        ],
        'm-p',
      ),
    ).resolves.toBeUndefined();

    expect(vendorPaymentJournalService.addSettledInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        JournalBatchNumber: 'Mesco-000014745',
        JournalLineNumber: 16,
        InvoiceNumber: '106551',
        InvoiceDueDate: '2026-04-30T12:00:00Z',
        SettlementAmountInInvoiceCurrency: -34610.4,
      }),
    );
    expect(d365foClient.post).not.toHaveBeenCalled();
  });

  it('fails when VendTransOpen prevents settlement confirmation', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();
    vendorPaymentJournalService.listIntegrityLinesForHeader.mockResolvedValue([
      {
        LineNumber: 50,
        AccountDisplayValue: 'RP-000003',
        DebitAmount: 19562.4,
        CreditAmount: 0,
        MarkedInvoice: '',
      },
    ]);
    vendorPaymentJournalService.listSettledInvoicesForHeader.mockResolvedValue(
      [],
    );
    vendorPaymentJournalService.addSettledInvoice.mockRejectedValue(
      new Error(
        "Matching record for the read only data source 'VendTransOpen' does not exist.",
      ),
    );
    d365foClient.get.mockResolvedValue({
      value: [
        {
          Invoice: '102260',
          AccountNum: 'RP-000003',
          AmountCur: -19248.9,
          SettleAmountCur: 0,
          CurrencyCode: 'EGP',
          DueDate: '2025-12-21T12:00:00Z',
          Closed: '1900-01-01T12:00:00Z',
        },
        {
          Invoice: '102260',
          AccountNum: 'RP-000003',
          AmountCur: -19562.4,
          SettleAmountCur: 0,
          CurrencyCode: 'EGP',
          DueDate: '2026-04-22T12:00:00Z',
          Closed: '1900-01-01T12:00:00Z',
        },
      ],
    });

    await expect(
      service.assertCashOutSettlementIntegrity(
        'Mesco-000014833',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 50,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'RP-000003',
              currency: 'EGP',
              debitAmount: 19562.4,
              creditAmount: 0,
              MarkedLines: [{ InvoiceNumber: '102260' }],
            },
          } as any,
        ],
        'm-p',
      ),
    ).rejects.toThrow('invoice settlement mismatch');

    expect(vendorPaymentJournalService.deleteLine).not.toHaveBeenCalled();
    expect(vendorPaymentJournalService.deleteHeader).not.toHaveBeenCalled();
  });

  it('continues repairing later settlement marks after one invoice is already settled', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();
    vendorPaymentJournalService.listIntegrityLinesForHeader.mockResolvedValue([
      {
        LineNumber: 1,
        AccountDisplayValue: 'RP-000003',
        DebitAmount: 100,
        CreditAmount: 0,
        MarkedInvoice: '',
      },
      {
        LineNumber: 2,
        AccountDisplayValue: 'RP-000003',
        DebitAmount: 200,
        CreditAmount: 0,
        MarkedInvoice: '',
      },
    ]);
    vendorPaymentJournalService.listSettledInvoicesForHeader
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          JournalLineCompany: 'm-p',
          JournalBatchNumber: 'Mesco-000014745',
          JournalLineNumber: 2,
          InvoiceNumber: 'INV-2',
          InvoiceCompany: 'm-p',
        },
      ]);
    vendorPaymentJournalService.addSettledInvoice
      .mockRejectedValueOnce(
        new Error(
          "Matching record for the read only data source 'VendTransOpen' does not exist.",
        ),
      )
      .mockResolvedValueOnce(undefined);
    d365foClient.get.mockResolvedValue({
      value: [
        {
          Invoice: 'INV-1',
          AccountNum: 'RP-000003',
          AmountCur: -100,
          SettleAmountCur: 0,
          CurrencyCode: 'EGP',
          DueDate: '2026-04-30T12:00:00Z',
          Closed: '1900-01-01T12:00:00Z',
        },
        {
          Invoice: 'INV-2',
          AccountNum: 'RP-000003',
          AmountCur: -200,
          SettleAmountCur: 0,
          CurrencyCode: 'EGP',
          DueDate: '2026-04-30T12:00:00Z',
          Closed: '1900-01-01T12:00:00Z',
        },
      ],
    });

    await expect(
      service.assertCashOutSettlementIntegrity(
        'Mesco-000014745',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 1,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'RP-000003',
              currency: 'EGP',
              debitAmount: 100,
              creditAmount: 0,
              MarkedLines: [{ InvoiceNumber: 'INV-1' }],
            },
          } as any,
          {
            dataAreaId: 'm-p',
            LineNumber: 2,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'RP-000003',
              currency: 'EGP',
              debitAmount: 200,
              creditAmount: 0,
              MarkedLines: [{ InvoiceNumber: 'INV-2' }],
            },
          } as any,
        ],
        'm-p',
      ),
    ).rejects.toThrow('invoice settlement mismatch');

    expect(vendorPaymentJournalService.addSettledInvoice).toHaveBeenCalledTimes(
      2,
    );
    expect(
      vendorPaymentJournalService.addSettledInvoice,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({ InvoiceNumber: 'INV-2' }),
    );
  });

  it('accepts an already-settled repair race only when the same journal owns the mark', async () => {
    const { service, d365foClient, vendorPaymentJournalService } =
      buildService();
    vendorPaymentJournalService.listIntegrityLinesForHeader.mockResolvedValue([
      {
        LineNumber: 1,
        AccountDisplayValue: 'RP-000003',
        DebitAmount: 95,
        CreditAmount: 0,
        MarkedInvoice: '',
      },
    ]);
    vendorPaymentJournalService.listSettledInvoicesForHeader.mockResolvedValue(
      [],
    );
    vendorPaymentJournalService.listSettlementOwnersForInvoices
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          JournalLineCompany: 'm-p',
          JournalBatchNumber: 'Mesco-000014855',
          JournalLineNumber: 1,
          InvoiceNumber: '39084/2',
          InvoiceCompany: 'm-p',
        },
      ])
      .mockResolvedValue([
        {
          JournalLineCompany: 'm-p',
          JournalBatchNumber: 'Mesco-000014855',
          JournalLineNumber: 1,
          InvoiceNumber: '39084/2',
          InvoiceCompany: 'm-p',
        },
      ]);
    vendorPaymentJournalService.addSettledInvoice.mockRejectedValue(
      new Error(
        'The invoice is no longer available for payment; it might have been settled by another user.',
      ),
    );
    d365foClient.get.mockResolvedValue({
      value: [
        {
          Invoice: '39084/2',
          AccountNum: 'RP-000003',
          AmountCur: -95,
          SettleAmountCur: 0,
          CurrencyCode: 'USD',
          DueDate: '2026-03-14T12:00:00Z',
          Closed: '1900-01-01T12:00:00Z',
        },
      ],
    });

    await expect(
      service.assertCashOutSettlementIntegrity(
        'Mesco-000014855',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 1,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'RP-000003',
              currency: 'USD',
              debitAmount: 95,
              creditAmount: 0,
              MarkedLines: [{ InvoiceNumber: '39084/2' }],
            },
          } as any,
        ],
        'm-p',
      ),
    ).resolves.toBeUndefined();
  });

  it('fails when extra settlement children make the result non-exact', async () => {
    const { service } = buildService();
    const verify = jest
      .spyOn(service, 'verifyCashOutSettlementIntegrity')
      .mockResolvedValue({
        matches: false,
        expectedCount: 1,
        actualCount: 2,
        missing: [
          {
            lineNumber: 50,
            invoiceNumber: '102260',
            vendorAccount: 'RP-000003',
            currency: 'EGP',
            settlementAmount: -19562.4,
          },
        ],
        unexpected: [
          {
            lineNumber: 51,
            invoiceNumber: '102260',
          },
        ],
        blockers: [],
        repaired: [],
        repairErrors: [
          {
            lineNumber: 50,
            invoiceNumber: '102260',
            message:
              "Matching record for the read only data source 'VendTransOpen' does not exist.",
          },
        ],
      });

    await expect(
      service.assertCashOutSettlementIntegrity(
        'Mesco-000014836',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 50,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'RP-000003',
              currency: 'EGP',
              debitAmount: 19562.4,
              creditAmount: 0,
              MarkedLines: [{ InvoiceNumber: '102260' }],
            },
          } as any,
        ],
        'm-p',
      ),
    ).rejects.toThrow('invoice settlement mismatch');

    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('fails when 0 remaining and another journal owns a requested mark', async () => {
    const { service } = buildService();
    jest.spyOn(service, 'verifyCashOutSettlementIntegrity').mockResolvedValue({
      matches: false,
      expectedCount: 2,
      actualCount: 0,
      missing: [
        {
          lineNumber: 1,
          invoiceNumber: '2379790',
          vendorAccount: 'RP-000003',
          currency: 'EGP',
          settlementAmount: -100,
        },
        {
          lineNumber: 200,
          invoiceNumber: '18',
          vendorAccount: 'RP-000003',
          currency: 'EGP',
          settlementAmount: -17922.03,
        },
      ],
      unexpected: [],
      blockers: [
        {
          expectedLineNumber: 1,
          invoiceNumber: '2379790',
          journalBatchNumber: 'Mesco-000014835',
          journalLineNumber: 1,
          journalLineCompany: 'm-p',
        },
      ],
      repaired: [],
      repairErrors: [
        {
          lineNumber: 200,
          invoiceNumber: '18',
          message:
            'invoice 18 has at most 0 EGP remaining, below requested 17922.03 EGP',
        },
      ],
    });

    await expect(
      service.assertCashOutSettlementIntegrity(
        'Mesco-000014836',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 1,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: 'RP-000003',
              currency: 'EGP',
              debitAmount: 100,
              creditAmount: 0,
              MarkedLines: [{ InvoiceNumber: '2379790' }],
            },
          } as any,
        ],
        'm-p',
      ),
    ).rejects.toThrow('invoice settlement mismatch');
  });

  it('does not delete an unposted journal that already has monetary lines', async () => {
    const { service, vendorPaymentJournalService } = buildService();
    vendorPaymentJournalService.getHeaderIdentity.mockResolvedValue({
      JournalBatchNumber: 'Mesco-000014833',
      IsPosted: 'No',
    });
    vendorPaymentJournalService.listIntegrityLinesForHeader.mockResolvedValue([
      { LineNumber: 1, AccountDisplayValue: 'RP-000003' },
    ]);

    await expect(
      (service as any).tryDeleteBlockingJournalHeader('m-p', 'Mesco-000014833'),
    ).resolves.toBe(false);
    expect(vendorPaymentJournalService.deleteHeader).not.toHaveBeenCalled();
  });
});
