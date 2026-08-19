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
    headerExists: jest.fn().mockResolvedValue(true),
    getHeaderIdentity: jest.fn().mockResolvedValue({
      JournalBatchNumber: journalBatchNumber,
      Description: 'Cash journal identity',
    }),
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
      repairDuplicatedUnmarkedFallbackLines: jest.fn().mockResolvedValue(false),
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

  it('maps Petty Cash to RCash on LedgerJournalLineEntity', async () => {
    const harness = buildStrategy();
    harness.ledgerStrategy.postLinesForHeader.mockResolvedValue([]);
    harness.strategy.setRouteContext(glRoute);

    await harness.strategy.postLinesForHeader(
      'GL-0001',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 142,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'ALEXHO EG',
            accountTypeStr: 'petty cash',
            debitAmount: 0,
            creditAmount: 2394,
            currency: 'EGP',
            transDate: '2026-01-04',
          },
        } as any,
      ],
      'm-p',
    );

    expect(harness.ledgerStrategy.postLinesForHeader).toHaveBeenCalledWith(
      'GL-0001',
      [
        expect.objectContaining({
          AccountType: 'RCash',
          AccountDisplayValue: 'ALEXHO EG',
        }),
      ],
      'm-p',
      20,
    );
  });

  it('maps a petty-cash offset to RCash instead of Bank', async () => {
    const harness = buildStrategy();
    harness.ledgerStrategy.postLinesForHeader.mockResolvedValue([]);
    harness.strategy.setRouteContext(glRoute);

    await harness.strategy.postLinesForHeader(
      'GL-0003',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          cashDirection: 'out',
          customLineApiBody: {
            AccountNum: '124101|1101|011|001',
            accountTypeStr: 'ledger',
            offsetAccountDisplayValue: 'ALEXHO EG',
            OffsetAccountTypeStr: 'RCash',
          },
        } as any,
      ],
      'm-p',
    );

    const [mappedLine] = harness.ledgerStrategy.postLinesForHeader.mock
      .calls[0][1];
    expect(mappedLine).toMatchObject({
      AccountType: 'Ledger',
      OffsetAccountType: 'RCash',
      OffsetAccountDisplayValue: 'ALEXHO EG',
    });
  });

  it('does not send the Cash API dimension string to LedgerJournalLineEntity', async () => {
    const harness = buildStrategy();
    harness.ledgerStrategy.postLinesForHeader.mockResolvedValue([]);
    harness.strategy.setRouteContext(glRoute);

    await harness.strategy.postLinesForHeader(
      'GL-0002',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 143,
          cashDirection: 'out',
          customLineApiBody: {
            AccountNum: '3135',
            accountTypeStr: 'vendor',
            DEFAULTDIMENSIONDISPLAYVALUE:
              '1301|013|001|001|101000358|101000358|3135|3135|16517|3042|3336|Collect|||IMPORT||||',
            offsetAccountDisplayValue: '101000358',
            OffsetAccountTypeStr: 'ledger',
            offsetDEFAULTDIMENSIONDISPLAYVALUE: 'invalid-target-format',
          },
        } as any,
      ],
      'm-p',
    );

    const [mappedLine] = harness.ledgerStrategy.postLinesForHeader.mock
      .calls[0][1];
    expect(mappedLine).not.toHaveProperty('DefaultDimensionDisplayValue');
    expect(mappedLine).not.toHaveProperty('OffsetDefaultDimensionDisplayValue');
  });

  it('omits PaymentMethod when PAYMENTMETHODNAME is a date string', async () => {
    const harness = buildStrategy();
    harness.ledgerStrategy.postLinesForHeader.mockResolvedValue([]);
    harness.strategy.setRouteContext(glRoute);

    await harness.strategy.postLinesForHeader(
      'GL-0004',
      [
        {
          dataAreaId: 'm-p',
          LineNumber: 144,
          cashDirection: 'out',
          customLineApiBody: {
            AccountNum: '124101|1101',
            accountTypeStr: 'ledger',
            PAYMENTMETHODNAME: '2026-01-22',
          },
        } as any,
      ],
      'm-p',
    );

    const [mappedLine] = harness.ledgerStrategy.postLinesForHeader.mock
      .calls[0][1];
    expect(mappedLine).not.toHaveProperty('PaymentMethod');
  });

  it.each([
    {
      name: 'AP',
      route: apRoute,
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
      harness.ledgerStrategy.postLinesForHeader.mockResolvedValue(postedLines);

      harness.strategy.setRouteContext(route);
      const result = await harness.strategy.postLinesForHeader(
        'Mesco-000020045',
        lines,
        'm-p',
        7,
      );

      if (route.kind === 'ledger') {
        expect(harness.ledgerStrategy.postLinesForHeader).toHaveBeenCalledWith(
          'Mesco-000020045',
          [expect.objectContaining({ AccountType: 'Ledger' })],
          'm-p',
          7,
        );
      } else {
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
      }
      expect(result).toEqual(postedLines);

      const allLineLookupMocks = [
        harness.vendorPaymentStrategy.listLinesForHeader,
        harness.ledgerStrategy.listLinesForHeader,
        harness.customerPaymentStrategy.listLinesForHeader,
      ];
      expect(
        allLineLookupMocks.filter((mock) => mock.mock.calls.length > 0),
      ).toHaveLength(route.kind === 'ledger' ? 0 : 1);
    },
  );

  it('puts the delegated customer-payment strategy in cash-in context for AR', () => {
    const { strategy, customerPaymentStrategy } = buildStrategy();

    strategy.setRouteContext(arRoute);

    expect(
      customerPaymentStrategy.setHeaderCashDirectionContext,
    ).toHaveBeenCalledWith('in');
  });

  it('returns the generated JournalBatchNumber without changing it', () => {
    const { strategy } = buildStrategy();

    expect(
      strategy.extractHeaderIdFromResponse({
        JournalBatchNumber: 'Mesco-000020045',
      }),
    ).toBe('Mesco-000020045');
  });

  it('reads header existence and line count from the routed D365 entity', async () => {
    const { strategy, vendorPaymentStrategy } = buildStrategy();
    strategy.setRouteContext(apRoute);

    await expect(
      strategy.getJournalIntegrityState('AP-0001', 'm-p'),
    ).resolves.toEqual({
      headerExists: true,
      lineCount: 1,
      headerDescription: 'Cash journal identity',
    });
    expect(vendorPaymentStrategy.getHeaderIdentity).toHaveBeenCalledWith(
      'AP-0001',
      'm-p',
    );
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
