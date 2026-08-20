import { BadRequestException } from '@nestjs/common';

import { PostCashBatchToDFOHandler } from './post-cash-batch-to-dfo.handler';

import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';
import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';
import { QUEUES } from '@/modules/queue/constants/queues';

describe('PostCashBatchToDFOHandler - task 2045 routing', () => {
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
    CurrencyCode: 'EGP',
    SalesTaxGroup: 'Non-Taxabl',
    PostingProfile: 'V-PP',
    FinTagDisplayValue: 'TAG-001',
    OffsetFinTagDisplayValue: 'TAG-002',
    PaymentMethodName: 'RCash',
    PaymentId: '1',
    TransactionText: 'Cash out',
    ExchangeRate: 100,
    ...overrides,
  });

  const makeCursor = (lines: Array<Record<string, unknown>>) => ({
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      for (let index = 0; index < lines.length; index++) {
        yield {
          _id: { toString: () => `record-${index + 1}` },
          batchId: 'batch-2045',
          sourceIds: [String(index + 1)],
          data: lines[index],
        };
      }
    },
    close: jest.fn().mockResolvedValue(undefined),
  });

  const buildHandler = (
    entryProcessorType: EntryProcessorTypes,
    lines: Array<Record<string, unknown>>,
  ) => {
    const dataBatchService = {
      getByIdAsync: jest.fn().mockResolvedValue({
        id: 'batch-2045',
        company: 'm-p',
        entryProcessorType,
        status: DataBatchStatus.PendingPosting,
        errorCount: 0,
      }),
      getEnhancedRecordsStream: jest.fn().mockResolvedValue(makeCursor(lines)),
      updateStatusAsync: jest.fn().mockResolvedValue(undefined),
      clearDfoPostingErrorsAsync: jest.fn().mockResolvedValue(undefined),
    };
    const queueService = {
      addDurableJob: jest.fn().mockResolvedValue({
        jobId: 'job-2045',
        message: 'queued',
        status: 'queued',
      }),
    };
    const handler = new PostCashBatchToDFOHandler(
      dataBatchService as any,
      queueService as any,
      new CashJournalRoutingService(),
    );

    return { handler, dataBatchService, queueService };
  };

  it.each([
    [EntryProcessorTypes.CashOutFreight, 'Freight', 'P-Freight'],
    [EntryProcessorTypes.CashOutTrucking, 'Fleet', 'P-Fleet'],
  ] as const)(
    'routes Vendor Payment processor %s to AP %s',
    async (entryProcessorType, targetProcessor, journalName) => {
      const { handler, queueService } = buildHandler(entryProcessorType, [
        makeLine(),
      ]);

      await handler.execute({ batchId: 'batch-2045' } as any);

      expect(queueService.addDurableJob).toHaveBeenCalledTimes(1);
      const [queue, jobName, metadata, groups] =
        queueService.addDurableJob.mock.calls[0];
      expect(queue).toBe(QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL);
      expect(jobName).toBe('post-customer-payment-journal-dfo');
      expect(metadata).toMatchObject({
        batchId: 'batch-2045',
        company: 'm-p',
        sourceModule: 'CASH',
        cashDirection: 'out',
        payloadVersion: 2,
      });
      expect(groups).toHaveLength(1);
      expect(groups[0].route).toEqual(
        expect.objectContaining({
          kind: 'vendor-invoice',
          module: 'AP',
          targetProcessor,
          journalName,
          headerApi: 'VendorPaymentJournalHeaders',
        }),
      );
      expect(groups[0].header).toMatchObject({
        JournalName: journalName,
        JournalBatchNumber: 'Mesco-000000001',
      });
      expect(groups[0].lines[0].cashDirection).toBe('out');
      expect(groups[0].lines[0].customLineApiBody).toHaveProperty(
        'ExchangeRate',
      );
    },
  );

  it('keeps Cash-In on the backward-compatible version-1 payload', async () => {
    const { handler, queueService } = buildHandler(
      EntryProcessorTypes.CashInFreight,
      [makeLine({ JournalName: 'Cust-Pay' })],
    );

    await handler.execute({ batchId: 'batch-2045' } as any);

    const [, , metadata, groups] = queueService.addDurableJob.mock.calls[0];
    expect(metadata).toMatchObject({
      cashDirection: 'in',
      payloadVersion: 1,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]).not.toHaveProperty('route');
  });

  it('keeps one durable job while splitting one provisional batch by AP, GL, and AR route', async () => {
    const { handler, queueService } = buildHandler(
      EntryProcessorTypes.CashOutFreight,
      [
        makeLine({ SafeType: 'Vendor Payment', LineNumber: 1 }),
        makeLine({
          SafeType: 'Direct',
          LineNumber: 2,
          AccountType: 'Ledger',
        }),
        makeLine({
          SafeType: 'DownPayment',
          LineNumber: 3,
          AccountType: 'Cust',
          PostingProfile: 'Cust-PP',
        }),
      ],
    );

    await handler.execute({ batchId: 'batch-2045' } as any);

    expect(queueService.addDurableJob).toHaveBeenCalledTimes(1);
    const groups = queueService.addDurableJob.mock.calls[0][3];
    expect(groups).toHaveLength(3);
    expect(groups.map((group: any) => group.route.headerApi)).toEqual([
      'VendorPaymentJournalHeaders',
      'LedgerJournalHeaders',
      'CustomerPaymentJournalHeaders',
    ]);
    expect(groups.map((group: any) => group.header.JournalName)).toEqual([
      'P-Freight',
      'CashOut',
      'Cust-Pay',
    ]);
    expect(groups[1].header).not.toHaveProperty('JournalBatchNumber');
    expect(groups.map((group: any) => group.lines[0].LineNumber)).toEqual([
      1, 1, 1,
    ]);
    expect(groups[2].lines[0].cashDirection).toBe('in');
  });

  it('keeps legacy Custody Issue rows postable through the GL CashOut route', async () => {
    const { handler, queueService } = buildHandler(
      EntryProcessorTypes.CashOutFreight,
      [
        makeLine({
          SafeType: 'Custody Issue',
          AccountType: 'Ledger',
          MarkedInvoice: '',
          Invoice: '',
        }),
      ],
    );

    await handler.execute({ batchId: 'batch-2045' } as any);

    const groups = queueService.addDurableJob.mock.calls[0][3];
    expect(groups).toHaveLength(1);
    expect(groups[0].route).toMatchObject({
      kind: 'vendor-invoice',
      module: 'AP',
      safeType: 'Custody Issue',
      journalName: 'P-Freight',
      headerApi: 'VendorPaymentJournalHeaders',
    });
  });

  it('rejects an unsupported Safe Type before changing status or enqueueing', async () => {
    const { handler, dataBatchService, queueService } = buildHandler(
      EntryProcessorTypes.CashOutFreight,
      [makeLine({ SafeType: 'Unsupported Legacy Type' })],
    );

    await expect(
      handler.execute({ batchId: 'batch-2045' } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      handler.execute({ batchId: 'batch-2045' } as any),
    ).rejects.toThrow('Unsupported Safe Type');
    expect(dataBatchService.updateStatusAsync).not.toHaveBeenCalled();
    expect(dataBatchService.clearDfoPostingErrorsAsync).not.toHaveBeenCalled();
    expect(queueService.addDurableJob).not.toHaveBeenCalled();
  });

  it('does not enqueue an empty job when every enhanced record lacks a batch number', async () => {
    const { handler, dataBatchService, queueService } = buildHandler(
      EntryProcessorTypes.CashOutFreight,
      [makeLine({ JournalBatchNumber: '' })],
    );

    await expect(
      handler.execute({ batchId: 'batch-2045' } as any),
    ).rejects.toThrow('No postable cash records were found');
    expect(dataBatchService.updateStatusAsync).not.toHaveBeenCalled();
    expect(queueService.addDurableJob).not.toHaveBeenCalled();
  });
});
