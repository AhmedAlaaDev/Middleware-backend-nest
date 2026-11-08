import { CashJournalPostingStrategy } from './cash-journal-posting.strategy';

import { CashJournalRoute } from '@/modules/cash/services/cash-journal-routing.service';
import {
  ActualJournalLine,
  decimalToCents,
} from '@/modules/d365fo/services/cash-journal-line-identity';

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

  const custodySettlementFleetRoute: CashJournalRoute = {
    kind: 'vendor-invoice',
    module: 'AP',
    safeType: 'Custody Settlement',
    targetProcessor: 'Fleet',
    journalName: 'P-Fleet',
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
      postCashOutLinesForHeaderAllowingSkips: jest.fn().mockResolvedValue({
        postedLines: [{ headerId: 'OUT-0001', lineNumber: 1 }],
        skipped: [],
      }),
    };
    const vendorInvoiceJournalService = {
      createVendorPaymentJournalLineSettlements: jest
        .fn()
        .mockResolvedValue([]),
      findInvoiceSettlementSnapshots: jest.fn().mockResolvedValue(new Map()),
    };
    const customerPaymentStrategy = {
      ...createHeaderStrategyMock('AR-0001', 31),
      setHeaderCashDirectionContext: jest.fn(),
    };
    const vendorPaymentStrategy = createHeaderStrategyMock('AP-0001', 11);
    // Default D365 read-back for Custody Settlement tests that mock the posting
    // service: D365 holds exactly the lines the (mocked) service reported as
    // posted, under its own numbers and without a voucher. Tests of the
    // verification itself override this with explicit D365 content.
    (vendorPaymentStrategy as any).listJournalLineDetails = jest
      .fn()
      .mockImplementation(async (): Promise<ActualJournalLine[]> => {
        const post =
          customerPaymentJournalService.postCashOutLinesForHeaderAllowingSkips;
        const call = post.mock.calls[post.mock.calls.length - 1];
        const result =
          await post.mock.results[post.mock.results.length - 1]?.value;
        if (!call || !result) return [];
        const posted = new Set(
          (result.postedLines as Array<{ lineNumber: number }>).map((l) =>
            Number(l.lineNumber),
          ),
        );
        return (call[1] as any[])
          .filter((line) => posted.has(Number(line.LineNumber)))
          .map((line, index) => ({
            lineNumber: 1000 + index,
            paymentId: String(line.customLineApiBody?.PAYMENTID ?? ''),
            accountType: String(line.customLineApiBody?.accountTypeStr ?? ''),
            account: String(line.customLineApiBody?.AccountNum ?? ''),
            currency: String(line.customLineApiBody?.currency ?? ''),
            debitCents: decimalToCents(line.customLineApiBody?.debitAmount),
            creditCents: decimalToCents(line.customLineApiBody?.creditAmount),
            voucher: '',
          }));
      });
    const ledgerStrategy = createHeaderStrategyMock('GL-0001', 21);

    const strategy = new CashJournalPostingStrategy(
      customerPaymentJournalService as any,
      vendorInvoiceJournalService as any,
      customerPaymentStrategy as any,
      vendorPaymentStrategy as any,
      ledgerStrategy as any,
    );

    return {
      strategy,
      customerPaymentJournalService,
      vendorInvoiceJournalService,
      customerPaymentStrategy,
      vendorPaymentStrategy,
      ledgerStrategy,
    };
  };

  it('rejects a Vendor Payment invoice that does not belong to the vendor', async () => {
    const harness = buildStrategy();
    harness.vendorInvoiceJournalService.findInvoiceSettlementSnapshots.mockResolvedValue(
      new Map([
        [
          'inv-1|vend-1',
          {
            invoice: 'INV-1',
            vendorAccount: 'VEND-1',
            exists: true,
            belongsToVendor: false,
          },
        ],
      ]),
    );
    harness.strategy.setRouteContext(apRoute);

    await expect(
      harness.strategy.validateLinesBeforeHeader(
        [
          {
            customLineApiBody: {
              AccountNum: 'VEND-1',
              accountTypeStr: 'Vendor',
              MarkedLines: [{ InvoiceNumber: 'INV-1', DocumentNumber: '' }],
            },
          },
        ],
        'm-p',
      ),
    ).rejects.toThrow('invoice/vendor mismatch');
  });

  it('does not preflight Custody Settlement invoices before header creation', async () => {
    const harness = buildStrategy();
    harness.strategy.setRouteContext(custodySettlementRoute);

    await harness.strategy.validateLinesBeforeHeader(
      [
        {
          customLineApiBody: {
            AccountNum: 'Sl-000036',
            accountTypeStr: 'Vendor',
            MarkedLines: [{ InvoiceNumber: 'INV-1', DocumentNumber: 'DOC-1' }],
          },
        },
      ],
      'm-p',
    );

    expect(
      harness.vendorInvoiceJournalService.findInvoiceSettlementSnapshots,
    ).not.toHaveBeenCalled();
  });

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

  it('keeps the custody document-operation mark and retains invoice for OData fallback', async () => {
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
          VendorGroup: 'Custody',
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
      harness.customerPaymentJournalService
        .postCashOutLinesForHeaderAllowingSkips.mock.calls[0][1];
    expect(postedLines[0].customLineApiBody.MarkedLines).toEqual([
      {
        InvoiceNumber: '920262100001342781',
        OperationNumber: 'O26-IMP-OC-3344',
        DocumentNumber: '20432',
        HasWithHoldingLine: false,
      },
    ]);
  });

  describe('native withholding', () => {
    const nativeLine = (vendorGroup: string) => ({
      dataAreaId: 'm-p',
      LineNumber: 5,
      sourceLineNumber: 3837,
      cashDirection: 'out',
      nativeWithholding: {
        withholdingGroup: 'WHT-3%',
        grossAmount: 2260.62,
        withholdingAmount: 59.49,
      },
      customLineApiBody: {
        journalNum: '',
        AccountNum: 'Sl-000036',
        accountTypeStr: 'Vendor',
        VendorGroup: vendorGroup,
        currency: 'USD',
        debitAmount: 2201.13,
        creditAmount: 0,
        PAYMENTID: '559989',
        ITEMWITHHOLDINGTAXGROUP: '',
        MarkedLines: [
          {
            InvoiceNumber: '5815410364',
            OperationNumber: 'OP-1',
            DocumentNumber: '25544',
            HasWithHoldingLine: true,
          },
        ],
      },
    });

    it('writes the group through X++ and hands the flag and gross mark to the settlement step', async () => {
      const harness = buildStrategy();
      harness.strategy.setRouteContext(custodySettlementRoute);

      await harness.strategy.postLinesForHeader(
        'Mesco-000019377',
        [nativeLine('Shiplines')],
        'm-p',
        20,
      );

      const posted =
        harness.customerPaymentJournalService
          .postCashOutLinesForHeaderAllowingSkips.mock.calls[0][1];
      // Sandbox-verified: X++ writes ITEMWITHHOLDINGTAXGROUP into the line's
      // TaxWithholdGroup; the calculation flag is enabled afterwards.
      expect(posted[0].customLineApiBody.ITEMWITHHOLDINGTAXGROUP).toBe(
        'WHT-3%',
      );
      expect(posted[0].customLineApiBody.MarkedLines).toEqual([]);
      const options =
        harness.vendorInvoiceJournalService
          .createVendorPaymentJournalLineSettlements.mock.calls[0][0];
      expect(options.targets).toEqual([
        expect.objectContaining({
          lineNumber: 5,
          debitAmount: 2201.13,
          invoiceNumber: '5815410364',
          uniqueId: '559989',
          withholdingAmount: 59.49,
          withholdingGroup: 'WHT-3%',
        }),
      ]);
    });

    it('refuses to post a native line that cannot reach the settlement step', async () => {
      const harness = buildStrategy();
      harness.strategy.setRouteContext(custodySettlementRoute);

      // A custody-holder vendor group is settled by document, so no OData
      // settlement target exists and the withholding would be lost.
      await expect(
        harness.strategy.postLinesForHeader(
          'Mesco-000019377',
          [nativeLine('Custody')],
          'm-p',
          20,
        ),
      ).rejects.toThrow('[WITHHOLDING_NOT_ENABLED]');
      expect(
        harness.customerPaymentJournalService
          .postCashOutLinesForHeaderAllowingSkips,
      ).not.toHaveBeenCalled();
    });
  });

  describe('native withholding on the Vendor Payment route', () => {
    const mark = {
      InvoiceNumber: '5815410364',
      OperationNumber: 'OP-1',
      DocumentNumber: '25544',
      HasWithHoldingLine: true,
    };
    const vendorPaymentLine = (options: {
      native: boolean;
      vendorGroup?: string;
      lineNumber?: number;
    }) => ({
      dataAreaId: 'm-p',
      LineNumber: options.lineNumber ?? 3,
      cashDirection: 'out',
      ...(options.native
        ? {
            nativeWithholding: {
              withholdingGroup: 'WHT-3%',
              grossAmount: 2260.62,
              withholdingAmount: 59.49,
            },
          }
        : {}),
      customLineApiBody: {
        journalNum: '',
        AccountNum: 'Sl-000036',
        accountTypeStr: 'Vendor',
        VendorGroup: options.vendorGroup ?? 'Shiplines',
        currency: 'EGP',
        debitAmount: 2201.13,
        creditAmount: 0,
        PAYMENTID: '559989',
        MarkedLines: [mark],
      },
    });

    it('marks the gross through the settlement step instead of X++', async () => {
      const harness = buildStrategy();
      harness.strategy.setRouteContext(apRoute);

      await harness.strategy.postLinesForHeader(
        'Mesco-000019377',
        [vendorPaymentLine({ native: true })],
        'm-p',
        20,
      );

      const posted =
        harness.customerPaymentJournalService.postCashOutLinesForHeader.mock
          .calls[0][1];
      expect(posted[0].customLineApiBody.MarkedLines).toEqual([]);
      expect(posted[0].customLineApiBody.ITEMWITHHOLDINGTAXGROUP).toBe(
        'WHT-3%',
      );
      const options =
        harness.vendorInvoiceJournalService
          .createVendorPaymentJournalLineSettlements.mock.calls[0][0];
      expect(options.continueOnError).toBe(false);
      expect(options.targets).toEqual([
        expect.objectContaining({
          lineNumber: 3,
          debitAmount: 2201.13,
          invoiceNumber: '5815410364',
          withholdingAmount: 59.49,
          withholdingGroup: 'WHT-3%',
        }),
      ]);
    });

    it('leaves an ordinary Vendor Payment line to X++ exactly as before', async () => {
      const harness = buildStrategy();
      harness.strategy.setRouteContext(apRoute);

      await harness.strategy.postLinesForHeader(
        'Mesco-000019377',
        [vendorPaymentLine({ native: false })],
        'm-p',
        20,
      );

      const posted =
        harness.customerPaymentJournalService.postCashOutLinesForHeader.mock
          .calls[0][1];
      expect(posted[0].customLineApiBody.MarkedLines).toEqual([mark]);
      expect(
        harness.vendorInvoiceJournalService
          .createVendorPaymentJournalLineSettlements,
      ).not.toHaveBeenCalled();
    });

    it('refuses a native Vendor Payment line that cannot reach the settlement step', async () => {
      const harness = buildStrategy();
      harness.strategy.setRouteContext(apRoute);

      await expect(
        harness.strategy.postLinesForHeader(
          'Mesco-000019377',
          [vendorPaymentLine({ native: true, vendorGroup: 'Custody' })],
          'm-p',
          20,
        ),
      ).rejects.toThrow('[WITHHOLDING_NOT_ENABLED] Vendor Payment line');
      expect(
        harness.customerPaymentJournalService.postCashOutLinesForHeader,
      ).not.toHaveBeenCalled();
    });

    it('settles after the lines exist, so the real D365 line can be resolved', async () => {
      const harness = buildStrategy();
      harness.strategy.setRouteContext(apRoute);

      await harness.strategy.postLinesForHeader(
        'Mesco-000019377',
        [vendorPaymentLine({ native: true })],
        'm-p',
        20,
      );

      expect(
        harness.customerPaymentJournalService.postCashOutLinesForHeader.mock
          .invocationCallOrder[0],
      ).toBeLessThan(
        harness.vendorInvoiceJournalService
          .createVendorPaymentJournalLineSettlements.mock
          .invocationCallOrder[0],
      );
    });
  });

  it('defers non-Custody marks until after Custody Settlement lines are posted', async () => {
    const harness = buildStrategy();
    const shiplineMark = {
      InvoiceNumber: 'INV-SHIP-1',
      OperationNumber: 'OP-1',
      DocumentNumber: 'DOC-1',
      HasWithHoldingLine: false,
    };
    const custodyMark = {
      InvoiceNumber: 'INV-CUSTODY-1',
      OperationNumber: 'OP-2',
      DocumentNumber: 'DOC-2',
      HasWithHoldingLine: false,
    };
    const lines = [
      {
        dataAreaId: 'm-p',
        LineNumber: 1,
        sourceLineNumber: 841,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'Sl-000020',
          accountTypeStr: 'Vendor',
          VendorGroup: 'Shiplines',
          currency: 'EGP',
          debitAmount: 300,
          creditAmount: 0,
          PAYMENTID: '475761',
          MarkedLines: [shiplineMark],
        },
      },
      {
        dataAreaId: 'm-p',
        LineNumber: 2,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: '3135',
          accountTypeStr: 'Vendor',
          VendorGroup: 'Custody',
          currency: 'EGP',
          debitAmount: 200,
          creditAmount: 0,
          MarkedLines: [custodyMark],
        },
      },
    ];

    harness.strategy.setRouteContext(custodySettlementRoute);
    await harness.strategy.postLinesForHeader(
      'Mesco-000015200',
      lines,
      'm-p',
      20,
    );

    const postedLines =
      harness.customerPaymentJournalService
        .postCashOutLinesForHeaderAllowingSkips.mock.calls[0][1];
    expect(postedLines[0].customLineApiBody.MarkedLines).toEqual([]);
    expect(postedLines[1].customLineApiBody.MarkedLines).toEqual([custodyMark]);
    expect(
      harness.vendorInvoiceJournalService
        .createVendorPaymentJournalLineSettlements,
    ).toHaveBeenCalledWith({
      company: 'm-p',
      journalBatchNumber: 'Mesco-000015200',
      targets: [
        {
          lineNumber: 1,
          vendorAccount: 'Sl-000020',
          currencyCode: 'EGP',
          debitAmount: 300,
          creditAmount: 0,
          invoiceNumber: 'INV-SHIP-1',
          documentNumber: 'DOC-1',
          uniqueId: '475761',
          sourceLineNumber: 841,
        },
      ],
      continueOnError: true,
      skipped: [],
    });
    expect(
      harness.customerPaymentJournalService
        .postCashOutLinesForHeaderAllowingSkips.mock.invocationCallOrder[0],
    ).toBeLessThan(
      harness.vendorInvoiceJournalService
        .createVendorPaymentJournalLineSettlements.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ['Freight', custodySettlementRoute],
    ['Fleet', custodySettlementFleetRoute],
  ] as const)(
    'uses UniqueId skip-and-report for Custody Settlement %s',
    async (_target, route) => {
      const harness = buildStrategy();
      harness.strategy.setRouteContext(route);

      await harness.strategy.postLinesForHeader(
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
            },
          },
        ],
        'm-p',
        20,
      );

      expect(
        harness.customerPaymentJournalService
          .postCashOutLinesForHeaderAllowingSkips,
      ).toHaveBeenCalledTimes(1);
      expect(
        harness.customerPaymentJournalService.postCashOutLinesForHeader,
      ).not.toHaveBeenCalled();
    },
  );

  it('does not defer MarkedLines for the separate Vendor Payment route', async () => {
    const harness = buildStrategy();
    const mark = {
      InvoiceNumber: 'INV-VP-1',
      OperationNumber: 'OP-VP',
      DocumentNumber: 'DOC-VP',
      HasWithHoldingLine: false,
    };
    const lines = [
      {
        dataAreaId: 'm-p',
        LineNumber: 1,
        cashDirection: 'out',
        customLineApiBody: {
          journalNum: '',
          AccountNum: 'Sl-000020',
          accountTypeStr: 'Vendor',
          VendorGroup: 'Shiplines',
          debitAmount: 300,
          creditAmount: 0,
          MarkedLines: [mark],
        },
      },
    ];

    harness.strategy.setRouteContext(apRoute);
    await harness.strategy.postLinesForHeader('AP-0002', lines, 'm-p', 20);

    const postedLine =
      harness.customerPaymentJournalService.postCashOutLinesForHeader.mock
        .calls[0][1][0];
    expect(postedLine.customLineApiBody.MarkedLines).toEqual([mark]);
    expect(
      harness.vendorInvoiceJournalService
        .createVendorPaymentJournalLineSettlements,
    ).not.toHaveBeenCalled();
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
          AccountNum: '124101|1602|016|001|003|201000283 |201000283 |3098|3098',
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
      harness.customerPaymentJournalService
        .postCashOutLinesForHeaderAllowingSkips.mock.calls[0][1][0]
        .customLineApiBody;
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

  it('skips a Custody Settlement vendor credit without DocumentNumber and keeps posting', async () => {
    const harness = buildStrategy();
    harness.strategy.setRouteContext(custodySettlementRoute);

    await harness.strategy.postLinesForHeader(
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
            VendorGroup: 'Custody',
            debitAmount: 0,
            creditAmount: 10000,
            DocumentNum: '',
            FinTagStr: 'O26-EXP-OC-5044|OTHER',
            PAYMENTID: 'SKIP-CREDIT',
            MarkedLines: [],
          },
        },
      ],
      'm-p',
      20,
    );

    expect(
      harness.customerPaymentJournalService
        .postCashOutLinesForHeaderAllowingSkips,
    ).toHaveBeenCalledWith(
      'Mesco-000015139',
      [],
      20,
      'm-p',
      expect.any(Function),
    );
    const skipped = harness.strategy.consumeSkipReport();
    expect(skipped).toEqual([
      expect.objectContaining({
        uniqueId: 'SKIP-CREDIT',
        phase: 'post',
        error: expect.stringContaining(
          'cannot be posted without DocumentNumber',
        ),
      }),
    ]);
  });

  it('posts later UniqueIds after an upload skip, then records settlement failures against the source Excel', async () => {
    const harness = buildStrategy();
    const failedPostSkip = {
      uniqueId: '475761',
      excelLineNumbers: [841],
      journalBatchNumber: 'Mesco-000015200',
      d365LineNumbers: [1],
      vendorAccount: 'Sl-000036',
      invoiceNumber: '5815372458',
      documentNumber: '16760',
      amount: 298.86,
      phase: 'post' as const,
      error: 'Dimension combination is not valid.',
    };
    harness.customerPaymentJournalService.postCashOutLinesForHeaderAllowingSkips.mockResolvedValue(
      {
        postedLines: [{ headerId: 'Mesco-000015200', lineNumber: 2 }],
        skipped: [failedPostSkip],
      },
    );
    harness.vendorInvoiceJournalService.createVendorPaymentJournalLineSettlements.mockImplementation(
      async (options: {
        targets: Array<{ uniqueId?: string }>;
        skipped?: Array<Record<string, unknown>>;
      }) => {
        expect(options.targets).toEqual([
          expect.objectContaining({
            uniqueId: '999001',
            invoiceNumber: 'INV-OK',
          }),
        ]);
        options.skipped?.push({
          uniqueId: '999001',
          excelLineNumbers: [900],
          journalBatchNumber: 'Mesco-000015200',
          d365LineNumbers: [2],
          vendorAccount: 'Sl-000020',
          invoiceNumber: 'INV-OK',
          documentNumber: 'DOC-OK',
          amount: 100,
          phase: 'settle',
          error:
            'Settlement amount 100 for cash-out line 2 (Excel UniqueId 999001) exceeds invoice INV-OK remainder 99.98.',
        });
        return [];
      },
    );

    harness.strategy.setRouteContext(custodySettlementRoute);
    await harness.strategy.postLinesForHeader(
      'Mesco-000015200',
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
            VendorGroup: 'Shiplines',
            currency: 'EGP',
            debitAmount: 298.86,
            creditAmount: 0,
            PAYMENTID: '475761',
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
            accountTypeStr: 'Vendor',
            VendorGroup: 'Shiplines',
            currency: 'EGP',
            debitAmount: 100,
            creditAmount: 0,
            PAYMENTID: '999001',
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
      ],
      'm-p',
      20,
    );

    expect(
      harness.vendorInvoiceJournalService
        .createVendorPaymentJournalLineSettlements,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        continueOnError: true,
        targets: [expect.objectContaining({ uniqueId: '999001' })],
      }),
    );
    expect(harness.strategy.consumeSkipReport()).toEqual([
      expect.objectContaining({
        uniqueId: '475761',
        phase: 'post',
        excelLineNumbers: [841],
      }),
      expect.objectContaining({
        uniqueId: '999001',
        phase: 'settle',
        excelLineNumbers: [900],
        error: expect.stringContaining('exceeds invoice INV-OK remainder'),
      }),
    ]);
  });

  it('OData-marks a UniqueId that was uploaded without settlement after an already-marked X++ error', async () => {
    const harness = buildStrategy();
    harness.customerPaymentJournalService.postCashOutLinesForHeaderAllowingSkips.mockResolvedValue(
      {
        postedLines: [
          { headerId: 'Mesco-000015604', lineNumber: 1 },
          { headerId: 'Mesco-000015604', lineNumber: 2 },
        ],
        skipped: [
          {
            uniqueId: '466596',
            excelLineNumbers: [900],
            journalBatchNumber: 'Mesco-000015604',
            d365LineNumbers: [1],
            vendorAccount: 'Sl-000020',
            invoiceNumber: 'INV-MARKED',
            documentNumber: 'DOC-MARKED',
            amount: 100,
            phase: 'settle',
            error:
              'Line uploaded without settlement: This transaction has been marked for settlement by Vendor Payment Freight Mesco-000015604 in company m-p.',
          },
        ],
      },
    );

    harness.strategy.setRouteContext(custodySettlementRoute);
    await harness.strategy.postLinesForHeader(
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
            VendorGroup: 'Shiplines',
            currency: 'EGP',
            debitAmount: 100,
            creditAmount: 0,
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
        },
        {
          dataAreaId: 'm-p',
          LineNumber: 2,
          sourceLineNumber: 901,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: 'Sl-000036',
            accountTypeStr: 'Vendor',
            VendorGroup: 'Shiplines',
            currency: 'EGP',
            debitAmount: 200,
            creditAmount: 0,
            PAYMENTID: '999001',
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
      ],
      'm-p',
      20,
    );

    expect(
      harness.vendorInvoiceJournalService
        .createVendorPaymentJournalLineSettlements,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        continueOnError: true,
        targets: expect.arrayContaining([
          expect.objectContaining({
            uniqueId: '466596',
            invoiceNumber: 'INV-MARKED',
          }),
          expect.objectContaining({ uniqueId: '999001' }),
        ]),
      }),
    );
    expect(
      harness.vendorInvoiceJournalService
        .createVendorPaymentJournalLineSettlements.mock.calls[0][0].targets,
    ).toHaveLength(2);
    expect(harness.strategy.consumeSkipReport()).toEqual([
      expect.objectContaining({
        uniqueId: '466596',
        phase: 'settle',
        error: expect.stringContaining('has been marked for settlement'),
      }),
    ]);
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

  describe('Custody Settlement journal verification before settlement marks', () => {
    const LEDGER =
      '223404|1201|012|001|001|301000002|301000002|3066|3066|16517|MESCO CC ALEX|3115|Payable|||EXPORT||||';

    /**
     * One balanced Custody UniqueId: a supplier invoice debit (settled by
     * invoice) against a ledger credit and a petty-cash credit.
     */
    const custodyLines = () => {
      const body = (extra: Record<string, unknown>) => ({
        journalNum: '',
        currency: 'EGP',
        PAYMENTID: 'U-1',
        debitAmount: 0,
        creditAmount: 0,
        ...extra,
      });
      return [
        {
          dataAreaId: 'm-p',
          LineNumber: 1,
          sourceLineNumber: 901,
          cashDirection: 'out' as const,
          customLineApiBody: body({
            AccountNum: 'Sl-000020',
            accountTypeStr: 'Vendor',
            VendorGroup: 'Shiplines',
            debitAmount: 200,
            MarkedLines: [
              {
                InvoiceNumber: 'INV-1',
                OperationNumber: '',
                DocumentNumber: 'DOC-1',
                HasWithHoldingLine: false,
              },
            ],
          }),
        },
        {
          dataAreaId: 'm-p',
          LineNumber: 2,
          sourceLineNumber: 902,
          cashDirection: 'out' as const,
          customLineApiBody: body({
            AccountNum: LEDGER,
            accountTypeStr: 'Ledger',
            creditAmount: 100,
          }),
        },
        {
          dataAreaId: 'm-p',
          LineNumber: 3,
          sourceLineNumber: 903,
          cashDirection: 'out' as const,
          customLineApiBody: body({
            AccountNum: 'AlexHO EG',
            accountTypeStr: 'RCash',
            creditAmount: 100,
          }),
        },
      ];
    };

    const postedAll = {
      postedLines: [1, 2, 3].map((lineNumber) => ({
        headerId: 'Mesco-1',
        lineNumber,
      })),
      skipped: [],
    };

    /** The journal as D365 returns it: its own numbers, canonical casing. */
    const d365Journal = (): ActualJournalLine[] => [
      {
        lineNumber: 41,
        paymentId: 'U-1',
        accountType: 'Vend',
        account: 'Sl-000020',
        currency: 'EGP',
        debitCents: 20000,
        creditCents: 0,
        voucher: 'P-Freight-1',
      },
      {
        lineNumber: 42,
        paymentId: 'U-1',
        accountType: 'Ledger',
        account: LEDGER.replace('EXPORT', 'Export'),
        currency: 'EGP',
        debitCents: 0,
        creditCents: 10000,
        voucher: 'P-Freight-1',
      },
      {
        lineNumber: 43,
        paymentId: 'U-1',
        accountType: 'RCash',
        account: 'AlexHO EG',
        currency: 'EGP',
        debitCents: 0,
        creditCents: 10000,
        voucher: 'P-Freight-1',
      },
    ];

    const run = async (
      journal: ActualJournalLine[] | Error,
      posted = postedAll,
      extraLines: ReturnType<typeof custodyLines> = [],
    ) => {
      const harness = buildStrategy();
      harness.customerPaymentJournalService.postCashOutLinesForHeaderAllowingSkips.mockResolvedValue(
        posted,
      );
      if (journal instanceof Error) {
        harness.vendorPaymentStrategy.listJournalLineDetails.mockRejectedValue(
          journal,
        );
      } else {
        harness.vendorPaymentStrategy.listJournalLineDetails.mockResolvedValue(
          journal,
        );
      }
      harness.strategy.setRouteContext(custodySettlementRoute);
      const outcome = harness.strategy
        .postLinesForHeader(
          'Mesco-1',
          [...custodyLines(), ...extraLines],
          'm-p',
          20,
        )
        .then(
          () => undefined,
          (error: Error) => error,
        );
      return { harness, error: await outcome };
    };

    const marksWritten = (harness: ReturnType<typeof buildStrategy>) =>
      harness.vendorInvoiceJournalService
        .createVendorPaymentJournalLineSettlements.mock.calls.length;

    it('writes settlement marks when D365 holds exactly the expected journal', async () => {
      const { harness, error } = await run(d365Journal());

      expect(error).toBeUndefined();
      expect(marksWritten(harness)).toBe(1);
    });

    it.each([
      [
        'a missing line',
        (j: ActualJournalLine[]) => j.slice(0, 2),
        '[JOURNAL_LINES_MISSING]',
      ],
      [
        'an extra line',
        (j: ActualJournalLine[]) => [
          ...j,
          { ...j[0], lineNumber: 44, paymentId: 'STRANGER' },
        ],
        '[JOURNAL_LINE_MISMATCH]',
      ],
      [
        'a duplicated line',
        (j: ActualJournalLine[]) => [...j, { ...j[2], lineNumber: 44 }],
        '[JOURNAL_LINE_MISMATCH]',
      ],
      [
        'the wrong vendor',
        (j: ActualJournalLine[]) => [
          { ...j[0], account: 'Sl-000099' },
          j[1],
          j[2],
        ],
        '[JOURNAL_LINE_MISMATCH]',
      ],
      [
        'the wrong ledger account',
        (j: ActualJournalLine[]) => [
          j[0],
          { ...j[1], account: LEDGER.replace('223404', '223405') },
          j[2],
        ],
        '[JOURNAL_LINE_MISMATCH]',
      ],
      [
        'the wrong currency',
        (j: ActualJournalLine[]) => [j[0], j[1], { ...j[2], currency: 'USD' }],
        '[JOURNAL_LINE_MISMATCH]',
      ],
      [
        'the wrong debit amount',
        (j: ActualJournalLine[]) => [
          { ...j[0], debitCents: 20001 },
          j[1],
          j[2],
        ],
        '[JOURNAL_LINE_MISMATCH]',
      ],
      [
        'the wrong credit amount',
        (j: ActualJournalLine[]) => [
          j[0],
          { ...j[1], creditCents: 9999 },
          j[2],
        ],
        '[JOURNAL_LINE_MISMATCH]',
      ],
      [
        'wrong lines with the same count and totals (credits swapped)',
        (j: ActualJournalLine[]) => [
          j[0],
          { ...j[1], creditCents: 4000 },
          { ...j[2], creditCents: 16000 },
        ],
        '[JOURNAL_LINE_MISMATCH]',
      ],
      [
        'a ledger line whose dimension value was changed',
        (j: ActualJournalLine[]) => [
          j[0],
          { ...j[1], account: LEDGER.replace('16517', '16518') },
          j[2],
        ],
        '[JOURNAL_LINE_MISMATCH]',
      ],
      [
        'an unbalanced voucher',
        (j: ActualJournalLine[]) => [
          j[0],
          j[1],
          { ...j[2], voucher: 'P-Freight-2' },
        ],
        '[JOURNAL_IMBALANCE]',
      ],
    ])(
      'stops before any settlement mark when D365 holds %s',
      async (_name, tamper, code) => {
        const { harness, error } = await run(tamper(d365Journal()));

        expect(error?.message).toContain(code);
        expect(error?.message).toContain('settlement marks were not written');
        expect(marksWritten(harness)).toBe(0);
      },
    );

    it('writes settlement marks when D365 dropped dimension values (account structure), as for 223404 in production', async () => {
      const journal = d365Journal();
      // The plan carries 13 dimensions; D365 keeps the 4 its account
      // structure allows for this main account and stores the rest empty.
      journal[1] = {
        ...journal[1],
        account: '223404|1201|012|001|001|||||||||||||||',
      };

      const { harness, error } = await run(journal);

      expect(error).toBeUndefined();
      expect(marksWritten(harness)).toBe(1);
    });

    it('stops before any settlement mark when the journal cannot be read back', async () => {
      const { harness, error } = await run(new Error('OData unavailable'));

      expect(error?.message).toContain('[JOURNAL_READBACK_FAILED]');
      expect(error?.message).toContain('OData unavailable');
      expect(marksWritten(harness)).toBe(0);
    });

    it('verifies only the lines of UniqueIds that were posted, not skipped ones', async () => {
      // UniqueId U-2 (lines 4 and 5) was skipped by the posting service, so
      // only U-1's three lines count as posted and D365 is expected to hold
      // exactly those.
      const skippedUniqueId = custodyLines()
        .slice(1)
        .map((line, index) => ({
          ...line,
          LineNumber: 4 + index,
          customLineApiBody: { ...line.customLineApiBody, PAYMENTID: 'U-2' },
        }));
      const { harness, error } = await run(
        d365Journal(),
        postedAll,
        skippedUniqueId,
      );

      expect(error).toBeUndefined();
      expect(marksWritten(harness)).toBe(1);
    });

    it('does not verify the journal for a route that is not Custody Settlement', async () => {
      const harness = buildStrategy();
      harness.strategy.setRouteContext(apRoute);

      await harness.strategy.postLinesForHeader('AP-0001', [], 'm-p', 20);

      expect(
        harness.vendorPaymentStrategy.listJournalLineDetails,
      ).not.toHaveBeenCalled();
    });
  });
});
