import { CashJournalPostingStrategy } from './cash-journal-posting.strategy';

import { CashJournalRoute } from '@/modules/cash/services/cash-journal-routing.service';

describe('CashJournalPostingStrategy', () => {
  const apRoute: CashJournalRoute = {
    kind: 'vendor-invoice',
    module: 'AP',
    safeType: 'Vendor Payment',
    targetProcessor: 'Freight',
    journalName: 'P-Freight',
    headerApi: 'VendorPaymentJournalHeaders',
    lineDirection: 'out',
  };

  const glRoute: CashJournalRoute = {
    kind: 'ledger',
    module: 'GL',
    safeType: 'Direct',
    journalName: 'CashOut',
    headerApi: 'LedgerJournalHeaders',
    lineDirection: 'out',
  };

  const custodySettlementRoute: CashJournalRoute = {
    kind: 'vendor-invoice',
    module: 'AP',
    safeType: 'Custody Settlement',
    targetProcessor: 'Freight',
    journalName: 'P-Freight',
    headerApi: 'VendorPaymentJournalHeaders',
    lineDirection: 'out',
  };

  const custodyIssueRoute: CashJournalRoute = {
    kind: 'vendor-invoice',
    module: 'AP',
    safeType: 'Custody Issue',
    targetProcessor: 'Fleet',
    journalName: 'P-Fleet',
    headerApi: 'VendorPaymentJournalHeaders',
    lineDirection: 'out',
  };

  const arRoute: CashJournalRoute = {
    kind: 'customer-payment',
    module: 'AR',
    safeType: 'DownPayment',
    journalName: 'Cust-Pay',
    headerApi: 'CustomerPaymentJournalHeaders',
    lineDirection: 'in',
  };

  const createHeaderStrategyMock = (
    journalBatchNumber: string,
    existingLineNumber: number,
  ) => ({
    postHeadersInBatches: jest.fn().mockResolvedValue({
      headerIds: [journalBatchNumber],
      responses: [{ JournalBatchNumber: journalBatchNumber }],
    }),
    postLinesInBatches: jest.fn(),
    postLinesForHeader: jest.fn(),
    deleteHeader: jest.fn().mockResolvedValue(undefined),
    deleteLinesInBatches: jest.fn().mockResolvedValue({
      successful: [],
      failed: [],
    }),
    extractHeaderIdFromResponse: jest.fn(),
    listLinesForHeader: jest
      .fn()
      .mockResolvedValue([{ LineNumber: existingLineNumber }]),
  });

  const buildStrategy = () => {
    const customerPaymentJournalService = {
      postCashInLinesForHeader: jest
        .fn()
        .mockResolvedValue([{ headerId: 'AR-0001', lineNumber: 1 }]),
      postCashOutLinesForHeader: jest
        .fn()
        .mockResolvedValue([{ headerId: 'OUT-0001', lineNumber: 1 }]),
    };
    const customerPaymentStrategy = {
      ...createHeaderStrategyMock('AR-0001', 31),
      setHeaderCashDirectionContext: jest.fn(),
    };
    const vendorPaymentStrategy = createHeaderStrategyMock('AP-0001', 11);
    const ledgerStrategy = createHeaderStrategyMock('GL-0001', 21);

    const strategy = new CashJournalPostingStrategy(
      customerPaymentJournalService as any,
      customerPaymentStrategy as any,
      vendorPaymentStrategy as any,
      ledgerStrategy as any,
    );

    return {
      strategy,
      customerPaymentJournalService,
      customerPaymentStrategy,
      vendorPaymentStrategy,
      ledgerStrategy,
    };
  };

  it.each([
    {
      name: 'AP',
      route: apRoute,
      activeStrategy: 'vendorPaymentStrategy' as const,
      expectedBatch: 'AP-0001',
    },
    {
      name: 'Custody Issue AP Vendor Payment',
      route: custodyIssueRoute,
      activeStrategy: 'vendorPaymentStrategy' as const,
      expectedBatch: 'AP-0001',
    },
    {
      name: 'GL',
      route: glRoute,
      activeStrategy: 'ledgerStrategy' as const,
      expectedBatch: 'GL-0001',
    },
    {
      name: 'AR',
      route: arRoute,
      activeStrategy: 'customerPaymentStrategy' as const,
      expectedBatch: 'AR-0001',
    },
  ])(
    'delegates $name header creation to its matching strategy',
    async ({ route, activeStrategy, expectedBatch }) => {
      const harness = buildStrategy();
      const header = {
        dataAreaId: 'm-p',
        JournalName: route.journalName,
        Description: `${route.module} cash journal`,
      };

      harness.strategy.setRouteContext(route);
      const result = await harness.strategy.postHeadersInBatches([header], 1);

      expect(harness[activeStrategy].postHeadersInBatches).toHaveBeenCalledWith(
        [header],
        1,
      );
      expect(result).toEqual({
        headerIds: [expectedBatch],
        responses: [{ JournalBatchNumber: expectedBatch }],
      });

      const allHeaderPostMocks = [
        harness.vendorPaymentStrategy.postHeadersInBatches,
        harness.ledgerStrategy.postHeadersInBatches,
        harness.customerPaymentStrategy.postHeadersInBatches,
      ];
      expect(
        allHeaderPostMocks.filter((mock) => mock.mock.calls.length > 0),
      ).toHaveLength(1);
    },
  );

  it.each([
    {
      name: 'AP',
      route: apRoute,
      lineMethod: 'postCashOutLinesForHeader' as const,
      activeStrategy: 'vendorPaymentStrategy' as const,
      existingLineNumber: 11,
    },
    {
      name: 'Custody Issue AP Vendor Payment',
      route: custodyIssueRoute,
      lineMethod: 'postCashOutLinesForHeader' as const,
      activeStrategy: 'vendorPaymentStrategy' as const,
      existingLineNumber: 11,
    },
    {
      name: 'GL',
      route: glRoute,
      lineMethod: 'postCashOutLinesForHeader' as const,
      activeStrategy: 'ledgerStrategy' as const,
      existingLineNumber: 21,
    },
    {
      name: 'AR',
      route: arRoute,
      lineMethod: 'postCashInLinesForHeader' as const,
      activeStrategy: 'customerPaymentStrategy' as const,
      existingLineNumber: 31,
    },
  ])(
    'uses the custom $name line API and the route-specific existing-line loader',
    async ({ route, lineMethod, activeStrategy, existingLineNumber }) => {
      const harness = buildStrategy();
      const lines = [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          cashDirection: route.lineDirection,
          customLineApiBody: { journalNum: '' },
        },
      ];
      const postedLines = [{ headerId: 'Mesco-000020045', lineNumber: 1 }];

      harness.customerPaymentJournalService[lineMethod].mockImplementation(
        async (
          _headerKey: string,
          _lines: unknown[],
          _chunkSize: number,
          _dataAreaId: string,
          loadExistingLines: () => Promise<Array<{ LineNumber: number }>>,
        ) => {
          await expect(loadExistingLines()).resolves.toEqual([
            { LineNumber: existingLineNumber },
          ]);
          return postedLines;
        },
      );

      harness.strategy.setRouteContext(route);
      const result = await harness.strategy.postLinesForHeader(
        'Mesco-000020045',
        lines,
        'm-p',
        7,
      );

      expect(
        harness.customerPaymentJournalService[lineMethod],
      ).toHaveBeenCalledWith(
        ...[
          'Mesco-000020045',
          lines,
          7,
          'm-p',
          expect.any(Function),
          ...(route.kind === 'customer-payment' ? [true] : []),
        ],
      );
      expect(harness[activeStrategy].listLinesForHeader).toHaveBeenCalledWith(
        'Mesco-000020045',
        'm-p',
      );
      expect(result).toEqual(postedLines);

      const allLineLookupMocks = [
        harness.vendorPaymentStrategy.listLinesForHeader,
        harness.ledgerStrategy.listLinesForHeader,
        harness.customerPaymentStrategy.listLinesForHeader,
      ];
      expect(
        allLineLookupMocks.filter((mock) => mock.mock.calls.length > 0),
      ).toHaveLength(1);
    },
  );

  it('puts the delegated customer-payment strategy in cash-in context for AR', () => {
    const { strategy, customerPaymentStrategy } = buildStrategy();

    strategy.setRouteContext(arRoute);

    expect(
      customerPaymentStrategy.setHeaderCashDirectionContext,
    ).toHaveBeenCalledWith('in');
  });

  it('targets a Custody Settlement credit by document and operation without copying the supplier invoice', async () => {
    const harness = buildStrategy();
    const lines = [
      {
        dataAreaId: 'm-p',
        LineNumber: 527,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: '5025',
          accountTypeStr: 'Vendor',
          debitAmount: 0,
          creditAmount: 15000,
          DocumentNum: '20432',
          FinTagStr: 'O26-IMP-OC-3344|OTHER',
          MarkedLines: [
            {
              InvoiceNumber: '920262100001342781',
              OperationNumber: 'O26-IMP-OC-3344',
              DocumentNumber: '20432',
              HasWithHoldingLine: false,
            },
          ],
        },
      },
    ];

    harness.strategy.setRouteContext(custodySettlementRoute);
    await harness.strategy.postLinesForHeader(
      'Mesco-000015027',
      lines,
      'm-p',
      20,
    );

    const postedLines =
      harness.customerPaymentJournalService.postCashOutLinesForHeader.mock
        .calls[0][1];
    expect(postedLines[0].customLineApiBody.MarkedLines).toEqual([
      {
        InvoiceNumber: '',
        OperationNumber: 'O26-IMP-OC-3344',
        DocumentNumber: '20432',
        HasWithHoldingLine: false,
      },
    ]);
  });

  it('normalizes internal whitespace in an already queued composite ledger account', async () => {
    const harness = buildStrategy();
    const lines = [
      {
        dataAreaId: 'm-p',
        LineNumber: 215,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum:
            '124101|1602|016|001|003|201000283 |201000283 |3098|3098',
          accountTypeStr: 'Ledger',
          debitAmount: 14180,
          creditAmount: 0,
          DEFAULTDIMENSIONDISPLAYVALUE:
            '1602|016|001|003|201000283 |201000283 |3098|3098',
          offsetAccountDisplayValue: '',
          offsetDEFAULTDIMENSIONDISPLAYVALUE: '',
          MarkedLines: [],
        },
      },
    ];

    harness.strategy.setRouteContext(custodySettlementRoute);
    await harness.strategy.postLinesForHeader(
      'Mesco-000015139',
      lines,
      'm-p',
      20,
    );

    const postedBody =
      harness.customerPaymentJournalService.postCashOutLinesForHeader.mock
        .calls[0][1][0].customLineApiBody;
    expect(postedBody.AccountNum).toBe(
      '124101|1602|016|001|003|201000283|201000283|3098|3098',
    );
    expect(postedBody.DEFAULTDIMENSIONDISPLAYVALUE).toBe(
      '1602|016|001|003|201000283|201000283|3098|3098',
    );
  });

  it('normalizes an already queued Vendor Payment withholding offset account', async () => {
    const harness = buildStrategy();
    const lines = [
      {
        dataAreaId: 'm-p',
        LineNumber: 23,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'Su-000068',
          accountTypeStr: 'Vendor',
          debitAmount: 150,
          creditAmount: 0,
          offsetAccountDisplayValue:
            '223304|1101|011|001|004|201000282 |201000282 |Su-000068',
          offsetDEFAULTDIMENSIONDISPLAYVALUE:
            '1101|011|001|004|201000282 |201000282 |Su-000068',
          MarkedLines: [],
        },
      },
    ];

    harness.strategy.setRouteContext(apRoute);
    await harness.strategy.postLinesForHeader(
      'Mesco-000015021',
      lines,
      'm-p',
      20,
    );

    const postedBody =
      harness.customerPaymentJournalService.postCashOutLinesForHeader.mock
        .calls[0][1][0].customLineApiBody;
    expect(postedBody.offsetAccountDisplayValue).toBe(
      '223304|1101|011|001|004|201000282|201000282|Su-000068',
    );
    expect(postedBody.offsetDEFAULTDIMENSIONDISPLAYVALUE).toBe(
      '1101|011|001|004|201000282|201000282|Su-000068',
    );
  });

  it('rejects a Custody Settlement vendor credit instead of sending empty MarkedLines', async () => {
    const harness = buildStrategy();
    harness.strategy.setRouteContext(custodySettlementRoute);

    expect(() =>
      harness.strategy.postLinesForHeader(
        'Mesco-000015139',
        [
          {
            dataAreaId: 'm-p',
            LineNumber: 216,
            cashDirection: 'out',
            customLineApiBody: {
              journalNum: '',
              AccountNum: '3098',
              accountTypeStr: 'Vendor',
              debitAmount: 0,
              creditAmount: 10000,
              DocumentNum: '',
              FinTagStr: 'O26-EXP-OC-5044|OTHER',
              MarkedLines: [],
            },
          },
        ],
        'm-p',
        20,
      ),
    ).toThrow('cannot be posted without DocumentNumber');
  });

  it('returns the generated JournalBatchNumber without changing it', () => {
    const { strategy } = buildStrategy();

    expect(
      strategy.extractHeaderIdFromResponse({
        JournalBatchNumber: 'Mesco-000020045',
      }),
    ).toBe('Mesco-000020045');
  });

  it('rejects a delegated header response with a blank generated journal number', async () => {
    const { strategy, ledgerStrategy } = buildStrategy();
    ledgerStrategy.postHeadersInBatches.mockResolvedValue({
      headerIds: [undefined],
      responses: [{}],
    });
    strategy.setRouteContext(glRoute);

    await expect(
      strategy.postHeadersInBatches(
        [
          {
            dataAreaId: 'm-p',
            JournalName: 'CashOut',
            Description: 'GL cash journal',
          },
        ],
        1,
      ),
    ).rejects.toThrow('D365FO returned 0 valid cash journal number(s)');
  });

  it('rejects a header response that has no generated JournalBatchNumber', () => {
    const { strategy } = buildStrategy();

    expect(() => strategy.extractHeaderIdFromResponse({})).toThrow(
      'JournalBatchNumber not found in response',
    );
  });

  it('rejects a route whose kind and header API belong to different families', () => {
    const { strategy } = buildStrategy();

    expect(() =>
      strategy.setRouteContext({
        ...apRoute,
        headerApi: 'LedgerJournalHeaders',
      }),
    ).toThrow(
      'Invalid cash journal route for Vendor Payment: mismatched headerApi',
    );
  });

  it('rejects a durable route with a corrupted module or line direction', () => {
    const { strategy } = buildStrategy();

    expect(() =>
      strategy.setRouteContext({
        ...apRoute,
        module: 'AR',
        lineDirection: 'in',
      }),
    ).toThrow('mismatched module, lineDirection');
  });
});
