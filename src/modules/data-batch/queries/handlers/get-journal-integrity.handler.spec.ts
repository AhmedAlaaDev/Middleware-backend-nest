import { GetJournalIntegrityHandler } from './get-journal-integrity.handler';

import { GetJournalIntegrityQuery } from '@/modules/data-batch/queries/get-journal-integrity.query';

describe('GetJournalIntegrityHandler', () => {
  const buildHandler = () => {
    const financeLines = [
      {
        dataAreaId: 'm-p',
        JournalBatchNumber: 'Mesco-000014742',
        LineNumber: 1,
        AccountDisplayValue: 'RP-000003',
        PaymentId: '260196',
        CurrencyCode: 'EGP',
        DebitAmount: 100.25,
        CreditAmount: 0,
        FinTagDisplayValue: 'OP-1',
      },
      {
        dataAreaId: 'm-p',
        JournalBatchNumber: 'Mesco-000014742',
        LineNumber: 2,
        AccountDisplayValue: 'RP-000003',
        PaymentId: '260197',
        CurrencyCode: 'EGP',
        DebitAmount: 50,
        CreditAmount: 0,
        FinTagDisplayValue: 'OP-2',
      },
    ];
    const d365foClient = {
      get: jest.fn(async (endpoint: string) => {
        if (endpoint.includes('VendorPaymentJournalHeaders')) {
          return {
            value: [
              {
                dataAreaId: 'm-p',
                JournalBatchNumber: 'Mesco-000014742',
              },
            ],
          };
        }
        if (endpoint.includes('VendorPaymentJournalLines')) {
          return { value: financeLines };
        }
        return { value: [] };
      }),
    };
    const group = {
      jobId: 'dfo-customer-payment-journal-queue--6a7c144cac381037eeaa656a',
      index: 0,
      status: 'completed',
      payload: {
        header: { JournalName: 'P-Fleet' },
        lines: [
          {
            LineNumber: 1,
            customLineApiBody: {
              currency: 'EGP',
              debitAmount: 100.25,
              creditAmount: 0,
            },
          },
          {
            LineNumber: 2,
            customLineApiBody: {
              currency: 'EGP',
              debitAmount: 50,
              creditAmount: 0,
            },
          },
        ],
      },
    };
    const queueGroups = {
      findOne: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(group),
        }),
      }),
    };
    const dataBatchRepository = { getList: jest.fn() };
    const customerPaymentJournalService = {
      verifyCashOutSettlementIntegrity: jest.fn().mockResolvedValue({
        matches: true,
        expectedCount: 0,
        actualCount: 0,
        missing: [],
        unexpected: [],
        blockers: [],
        repaired: [],
        repairErrors: [],
      }),
    };
    const handler = new GetJournalIntegrityHandler(
      d365foClient as any,
      dataBatchRepository as any,
      queueGroups as any,
      customerPaymentJournalService as any,
    );
    return {
      handler,
      d365foClient,
      financeLines,
      customerPaymentJournalService,
    };
  };

  it('returns PASS when Finance line count and currency amounts match', async () => {
    const { handler } = buildHandler();

    const result = await handler.execute(
      new GetJournalIntegrityQuery('Mesco-000014742'),
    );

    expect(result.status).toBe('PASS');
    expect(result.isAmountCorrect).toBe(true);
    expect(result.hasDuplicates).toBe(false);
    expect(result.duplicationConclusion).toBe('NO_EXTRA_FINANCE_DATA');
    expect(result.summary).toEqual(
      expect.objectContaining({
        expectedLineCount: 2,
        actualLineCount: 2,
        lineCountMatches: true,
      }),
    );
    expect(result.summary.amountComparisonByCurrency).toEqual([
      expect.objectContaining({
        currency: 'EGP',
        expectedDebit: 150.25,
        actualDebit: 150.25,
        matches: true,
      }),
    ]);
    expect(result.finance.matches[0].lines).toHaveLength(2);
    expect(result.middleware.expectedLines).toHaveLength(2);
  });

  it('fails when a requested invoice mark is missing or owned by another journal', async () => {
    const { handler, customerPaymentJournalService } = buildHandler();
    customerPaymentJournalService.verifyCashOutSettlementIntegrity.mockResolvedValue(
      {
        matches: false,
        expectedCount: 251,
        actualCount: 250,
        missing: [{ lineNumber: 16, invoiceNumber: '106551' }],
        unexpected: [],
        blockers: [
          {
            expectedLineNumber: 16,
            invoiceNumber: '106551',
            journalBatchNumber: 'Mesco-000014711',
            journalLineNumber: 133,
            journalLineCompany: 'm-p',
          },
        ],
        repaired: [],
        repairErrors: [],
      },
    );

    const result = await handler.execute(
      new GetJournalIntegrityQuery('Mesco-000014745'),
    );

    expect(result.status).toBe('FAIL');
    expect(result.isSettlementCorrect).toBe(false);
    expect(result.issues).toContain(
      'Invoice settlement mismatch: Finance confirmed 250/251 expected mark(s). invoice 106551 is marked by Mesco-000014711 line 133.',
    );
    expect(result.settlementAnalysis.blockers).toHaveLength(1);
  });

  it('reports amount and duplicate integrity failures with full Finance lines', async () => {
    const { handler, financeLines } = buildHandler();
    financeLines.push({ ...financeLines[0] });

    const result = await handler.execute(
      new GetJournalIntegrityQuery('Mesco-000014742'),
    );

    expect(result.status).toBe('FAIL');
    expect(result.isAmountCorrect).toBe(false);
    expect(result.hasDuplicates).toBe(true);
    expect(result.duplicationConclusion).toBe('CONFIRMED_DUPLICATION');
    expect(result.summary.actualLineCount).toBe(3);
    expect(result.duplicationAnalysis.duplicateLineNumbers).toEqual([
      expect.objectContaining({ lineNumber: '1', occurrences: 2 }),
    ]);
    expect(result.finance.matches[0].lines).toHaveLength(3);
  });
});
