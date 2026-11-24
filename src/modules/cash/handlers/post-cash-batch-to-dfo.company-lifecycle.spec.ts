import { PostCashBatchToDFOHandler } from './post-cash-batch-to-dfo.handler';

import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';
import { CompanyConfigurationError } from '@/modules/master-data/company-run-config';
import { QUEUES } from '@/modules/queue/constants/queues';

/**
 * Company lifecycle at posting time: the saved batch decides the company, the
 * queued job carries it, and no company set by the client or by M-P data can
 * replace it.
 */
describe('PostCashBatchToDFOHandler company lifecycle', () => {
  const makeLine = (overrides: Record<string, unknown> = {}) => ({
    JournalBatchNumber: 'Mesco-000000001',
    JournalName: 'OLD-JOURNAL',
    Description: 'Cash out January 2026',
    LineNumber: 1,
    SafeType: 'Vendor Payment',
    VoucherType: 'Cash',
    AccountType: 'Vend',
    AccountDisplayValue: 'VEND-001',
    OffsetAccountType: 'Petty cash',
    OffsetAccountDisplayValue: 'SAFE-001',
    OffsetCompany: 'm-p',
    DefaultDimensionDisplayValue: '|CC|BU',
    OffsetDefaultDimensionDisplayValue: '|CC|BU',
    TransactionDate: '2026-01-15',
    DebitAmount: 100,
    CreditAmount: 0,
    CurrencyCode: 'USD',
    SalesTaxGroup: 'Non-Taxabl',
    PostingProfile: 'V-PP',
    FinTagDisplayValue: 'TAG-001',
    OffsetFinTagDisplayValue: 'TAG-002',
    PaymentMethodName: 'RCash',
    PaymentId: '1',
    TransactionText: 'Cash out',
    ExchangeRate: 50,
    ExchRate: 50,
    ...overrides,
  });

  const makeCursor = (lines: Array<Record<string, unknown>>) => ({
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      for (let index = 0; index < lines.length; index++) {
        yield {
          _id: { toString: () => `record-${index + 1}` },
          batchId: 'batch-x',
          sourceIds: [String(index + 1)],
          data: lines[index],
        };
      }
    },
    close: jest.fn().mockResolvedValue(undefined),
  });

  const ledger = (
    legalEntityId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    legalEntityId,
    accountingCurrency: 'EGP',
    reportingCurrency: 'USD',
    exchangeRateType: legalEntityId === 'mas' ? 'MASRate' : 'Default',
    chartOfAccounts:
      legalEntityId === 'mas' ? 'MAS Chart' : 'Chart of Accounts',
    ...overrides,
  });

  const buildHandler = (options: {
    batchCompany: string;
    lines: Array<Record<string, unknown>>;
    ledgers: Array<Record<string, unknown>>;
    entryProcessorType?: EntryProcessorTypes;
  }) => {
    const dataBatchService = {
      getByIdAsync: jest.fn().mockResolvedValue({
        id: 'batch-x',
        company: options.batchCompany,
        entryProcessorType:
          options.entryProcessorType ?? EntryProcessorTypes.CashOutFreight,
        status: DataBatchStatus.PendingPosting,
        errorCount: 0,
      }),
      getEnhancedRecordsStream: jest
        .fn()
        .mockResolvedValue(makeCursor(options.lines)),
      updateStatusAsync: jest.fn().mockResolvedValue(undefined),
      clearDfoPostingErrorsAsync: jest.fn().mockResolvedValue(undefined),
    };
    const queueService = {
      addDurableJob: jest.fn().mockResolvedValue({
        jobId: 'job-x',
        message: 'queued',
        status: 'queued',
      }),
    };
    // Ledger reads are scoped by the company the query asks for.
    const queryBus = {
      execute: jest.fn((query: { filter?: { company?: string } }) =>
        Promise.resolve({
          items: options.ledgers.filter(
            (row) => row.legalEntityId === query.filter?.company,
          ),
        }),
      ),
    };
    const handler = new PostCashBatchToDFOHandler(
      dataBatchService as never,
      queueService as never,
      new CashJournalRoutingService(),
      undefined,
      undefined,
      undefined,
      queryBus as never,
    );
    return { handler, queueService, queryBus };
  };

  it('posts a saved MAS batch with company mas in the queued job and every line', async () => {
    const { handler, queueService } = buildHandler({
      batchCompany: 'mas',
      lines: [makeLine()],
      ledgers: [ledger('mas')],
    });

    await handler.execute({ batchId: 'batch-x' } as never);

    expect(queueService.addDurableJob).toHaveBeenCalledTimes(1);
    const [queue, , metadata, groups] =
      queueService.addDurableJob.mock.calls[0];
    expect(queue).toBe(QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL);
    expect(metadata).toMatchObject({ batchId: 'batch-x', company: 'mas' });
    expect(JSON.stringify(groups)).toContain('"company":"mas"');
    expect(JSON.stringify(groups)).not.toContain('"company":"m-p"');
  });

  it('ignores a company supplied by the client: the saved batch decides', async () => {
    const { handler, queueService } = buildHandler({
      batchCompany: 'mas',
      lines: [makeLine()],
      ledgers: [ledger('mas'), ledger('m-p')],
    });

    await handler.execute({ batchId: 'batch-x', company: 'm-p' } as never);

    expect(queueService.addDurableJob.mock.calls[0][2]).toMatchObject({
      company: 'mas',
    });
  });

  it('posts MAS EGP accounting-currency lines with the D365-verified factor 100', async () => {
    const { handler, queueService } = buildHandler({
      batchCompany: 'mas',
      lines: [makeLine({ CurrencyCode: 'EGP', ExchangeRate: 100 })],
      ledgers: [ledger('mas')],
    });

    await handler.execute({ batchId: 'batch-x' } as never);

    const [, , metadata, groups] = queueService.addDurableJob.mock.calls[0];
    expect(metadata).toMatchObject({ company: 'mas' });
    expect(JSON.stringify(groups)).toContain('"ExchangeRate":100');
  });

  it('stops a MAS batch whose accounting currency has no verified factor, before any queue write', async () => {
    const { handler, queueService } = buildHandler({
      batchCompany: 'mas',
      lines: [makeLine({ CurrencyCode: 'EUR', ExchangeRate: 100, ExchRate: 100 })],
      ledgers: [ledger('mas', { accountingCurrency: 'EUR' })],
    });

    await expect(
      handler.execute({ batchId: 'batch-x' } as never),
    ).rejects.toBeInstanceOf(CompanyConfigurationError);
    expect(queueService.addDurableJob).not.toHaveBeenCalled();
  });

  it('never posts MAS through the M-P ledger: a missing MAS ledger stops the batch', async () => {
    const { handler, queueService } = buildHandler({
      batchCompany: 'mas',
      lines: [makeLine()],
      ledgers: [ledger('m-p')],
    });

    await expect(
      handler.execute({ batchId: 'batch-x' } as never),
    ).rejects.toThrow(/No ledger is synced for company "mas"/);
    expect(queueService.addDurableJob).not.toHaveBeenCalled();
  });

  it('keeps the M-P posting result unchanged: EGP lines still use the factor 100 without a ledger read', async () => {
    const { handler, queueService, queryBus } = buildHandler({
      batchCompany: 'm-p',
      lines: [makeLine({ CurrencyCode: 'EGP', ExchangeRate: 100 })],
      ledgers: [],
    });

    await handler.execute({ batchId: 'batch-x' } as never);

    expect(queryBus.execute).not.toHaveBeenCalled();
    const [, , metadata, groups] = queueService.addDurableJob.mock.calls[0];
    expect(metadata).toMatchObject({ company: 'm-p' });
    expect(JSON.stringify(groups)).toContain('"ExchangeRate":100');
  });

  it('isolates identical account and invoice IDs between an M-P and a MAS batch', async () => {
    const { handler, queueService } = buildHandler({
      batchCompany: 'mas',
      lines: [makeLine()],
      ledgers: [ledger('mas'), ledger('m-p')],
    });
    await handler.execute({ batchId: 'batch-x' } as never);

    const mas = buildHandler({
      batchCompany: 'm-p',
      lines: [makeLine({ CurrencyCode: 'EGP', ExchangeRate: 100 })],
      ledgers: [ledger('mas'), ledger('m-p')],
    });
    await mas.handler.execute({ batchId: 'batch-x' } as never);

    const masJob = queueService.addDurableJob.mock.calls[0];
    const mpJob = mas.queueService.addDurableJob.mock.calls[0];
    expect(masJob[2].company).toBe('mas');
    expect(mpJob[2].company).toBe('m-p');
    expect(masJob[2].batchId).toBe(mpJob[2].batchId);
    expect(JSON.stringify(masJob[3])).toContain('VEND-001');
    expect(JSON.stringify(mpJob[3])).toContain('VEND-001');
  });
});
