/* eslint-disable @typescript-eslint/require-await */
import { BadRequestException } from '@nestjs/common';

import { PostCashBatchToDFOHandler } from './post-cash-batch-to-dfo.handler';

import type { MasRevenueVerifiedConfig } from '@/modules/cash/mas-revenue/mas-revenue-config';

import { MasRevenueConfigProvider } from '@/modules/cash/mas-revenue/mas-revenue-config.provider';
import {
  MasRevenueStoredRaw,
  receiptToStoredRaw,
} from '@/modules/cash/mas-revenue/mas-revenue-stored';
import { completeMasRevenueConfig } from '@/modules/cash/mas-revenue/mas-revenue.test-fixtures';
import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';

const CASH = 'خزينة بور سعيد مصري';

function raw(
  invoice: string,
  sourceRow: number,
  date = '2026-10-28',
): MasRevenueStoredRaw {
  return receiptToStoredRaw(
    {
      sourceSheet: 'Row Data',
      sourceRow,
      invoiceNumber: invoice,
      transactionDate: date,
      currency: 'EGP',
      valueMinor: 160000,
      vatMinor: 22400,
      totalMinor: 182400,
      cashAccountDisplayName: CASH,
      customerName: 'شركة اختبار',
      containerType: null,
      containerNumber: null,
      billOfLading: null,
      revenueType: 'In',
      seaLine: null,
      vatCardNumber: null,
    },
    sourceRow - 1,
  );
}

function completeConfig(): MasRevenueVerifiedConfig {
  return completeMasRevenueConfig();
}

function records(
  entries: Array<{ id: string; journal: string; raw?: MasRevenueStoredRaw }>,
) {
  return (async function* () {
    for (const entry of entries) {
      yield {
        _id: { toString: () => entry.id },
        batchId: 'batch-1',
        data: { JournalBatchNumber: entry.journal, MasRevenueRaw: entry.raw },
        sourceIds: [],
      };
    }
  })();
}

function buildHandler(
  config: MasRevenueVerifiedConfig,
  cursor: () => AsyncIterable<unknown>,
  options: { cashChecks?: unknown[]; noVerifier?: boolean } = {},
) {
  const cashVerifier = options.noVerifier
    ? undefined
    : {
        verify: jest.fn(
          async (ids: string[]) =>
            options.cashChecks ??
            ids.map((id) => ({
              id,
              status: 'RCASH',
              currency: 'EGP',
              error: null,
            })),
        ),
      };
  const dataBatchService = {
    getByIdAsync: jest.fn(async () => ({
      id: 'batch-1',
      company: 'mas',
      entryProcessorType: EntryProcessorTypes.CashInMasRevenue,
      status: DataBatchStatus.PendingPosting,
      errorCount: 0,
      postingPaused: false,
    })),
    getEnhancedRecordsStream: jest.fn(async () => cursor()),
    updateStatusAsync: jest.fn(async () => undefined),
    clearDfoPostingErrorsAsync: jest.fn(async () => undefined),
  };
  const queueService = {
    addDurableJob: jest.fn(async () => ({
      jobId: 'job-1',
      message: 'queued',
      status: 'queued',
    })),
  };
  const provider = {
    current: () => ({ config, source: 'test' }),
  } as unknown as MasRevenueConfigProvider;
  const handler = new PostCashBatchToDFOHandler(
    dataBatchService as never,
    queueService as never,
    undefined,
    undefined,
    provider,
    cashVerifier as never,
  );
  return { handler, dataBatchService, queueService, cashVerifier };
}

describe('PostCashBatchToDFOHandler: MAS Revenue GL route', () => {
  it('queues one routed GL journal with a header and RCash/Ledger lines, version 2', async () => {
    const { handler, queueService, dataBatchService } = buildHandler(
      completeConfig(),
      () =>
        records([
          { id: 'r1', journal: 'MASREV-202610-001', raw: raw('0012', 2) },
          { id: 'r2', journal: 'MASREV-202610-001', raw: raw('0013', 3) },
        ]),
    );

    const result = await handler.execute({ batchId: 'batch-1' } as never);

    expect(result.jobId).toBe('job-1');
    expect(dataBatchService.updateStatusAsync).toHaveBeenCalledWith(
      'batch-1',
      DataBatchStatus.Posting,
    );
    const [, , payload, groups] = (queueService.addDurableJob as jest.Mock).mock
      .calls[0] as [
      string,
      string,
      { payloadVersion: number; cashDirection: string; company: string },
      Array<{
        route: {
          kind: string;
          module: string;
          safeType: string;
          headerApi: string;
          lineDirection: string;
          journalName: string;
        };
        header: {
          dataAreaId: string;
          JournalName: string;
          Description: string;
        };
        lines: Array<{
          dataAreaId: string;
          LineNumber: number;
          cashDirection: string;
          customLineApiBody: Record<string, unknown>;
        }>;
      }>,
    ];
    expect(payload).toMatchObject({
      payloadVersion: 2,
      cashDirection: 'in',
      company: 'mas',
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].route).toEqual({
      kind: 'ledger',
      module: 'GL',
      safeType: 'MAS Revenue',
      journalName: 'GL-VERIFIED',
      headerApi: 'LedgerJournalHeaders',
      lineDirection: 'in',
    });
    expect(groups[0].header).toMatchObject({
      dataAreaId: 'mas',
      JournalName: 'GL-VERIFIED',
    });
    expect(groups[0].lines.map((l) => l.LineNumber)).toEqual([1, 2, 3, 4]);
    expect(groups[0].lines[0]).toMatchObject({
      dataAreaId: 'mas',
      cashDirection: 'in',
    });
    expect(groups[0].lines[0].customLineApiBody).toMatchObject({
      accountTypeStr: 'RCash',
      AccountNum: 'PETTY-FIXTURE',
      OffsetAccountTypeStr: 'Ledger',
      offsetAccountDisplayValue: '415701|2401|024|002|005',
      company: 'mas',
      OffsetCompany: 'mas',
      debitAmount: 1600,
      journalNum: '',
      TaxGroup: '',
      TAXITEMGROUP: 'FIXTURE-ITEM-TAX',
    });
  });

  it('creates a separate journal for each planned journal group', async () => {
    const { handler, queueService } = buildHandler(completeConfig(), () =>
      records([
        {
          id: 'r1',
          journal: 'MASREV-202610-001',
          raw: raw('0012', 2, '2026-10-28'),
        },
        {
          id: 'r2',
          journal: 'MASREV-202611-001',
          raw: raw('0013', 3, '2026-11-02'),
        },
      ]),
    );
    await handler.execute({ batchId: 'batch-1' } as never);
    const groups = (queueService.addDurableJob as jest.Mock).mock
      .calls[0][3] as unknown[];
    expect(groups).toHaveLength(2);
  });

  it('resolves an empty stored currency from the verified D365 cash account at posting time', async () => {
    const { handler, queueService } = buildHandler(completeConfig(), () =>
      records([
        {
          id: 'r1',
          journal: 'MASREV-202610-001',
          raw: { ...raw('0012', 2), Currency: '' },
        },
      ]),
    );

    await handler.execute({ batchId: 'batch-1' } as never);

    const [, , , groups] = (queueService.addDurableJob as jest.Mock).mock
      .calls[0] as [
      string,
      string,
      unknown,
      Array<{ lines: Array<{ customLineApiBody: { currency: string } }> }>,
    ];
    expect(groups[0].lines[0].customLineApiBody.currency).toBe('EGP');
  });

  it('returns the blockers as a plain error list when a receipt currency cannot be resolved', async () => {
    const { handler, queueService } = buildHandler(
      completeConfig(),
      () =>
        records([
          {
            id: 'r1',
            journal: 'MASREV-202610-001',
            raw: { ...raw('0012', 2), Currency: '' },
          },
        ]),
      {
        cashChecks: [
          {
            id: 'PETTY-FIXTURE',
            status: 'UNKNOWN',
            currency: null,
            error: null,
          },
        ],
      },
    );

    await expect(
      handler.execute({ batchId: 'batch-1' } as never),
    ).rejects.toMatchObject({
      response: {
        errors: expect.arrayContaining([
          expect.stringContaining('currency is not resolved'),
        ]),
      },
    });
    expect(queueService.addDurableJob).not.toHaveBeenCalled();
  });

  it('blocks posting while the configuration is incomplete, before anything is queued', async () => {
    const { handler, queueService } = buildHandler(
      { ...completeConfig(), journalName: null },
      () =>
        records([
          { id: 'r1', journal: 'MASREV-202610-001', raw: raw('0012', 2) },
        ]),
    );
    await expect(
      handler.execute({ batchId: 'batch-1' } as never),
    ).rejects.toThrow(BadRequestException);
    expect(queueService.addDurableJob).not.toHaveBeenCalled();
  });

  it('blocks a record that has no stored receipt snapshot', async () => {
    const { handler, queueService } = buildHandler(completeConfig(), () =>
      records([{ id: 'r1', journal: 'MASREV-202610-001' }]),
    );
    await expect(
      handler.execute({ batchId: 'batch-1' } as never),
    ).rejects.toThrow(/no receipt snapshot/);
    expect(queueService.addDurableJob).not.toHaveBeenCalled();
  });
});

describe('PostCashBatchToDFOHandler: MAS cash-account checks at posting', () => {
  it('blocks the post when a configured cash ID is unknown in D365, before anything is queued', async () => {
    const { handler, queueService, dataBatchService } = buildHandler(
      completeConfig(),
      () =>
        records([
          { id: 'r1', journal: 'MASREV-202610-001', raw: raw('0012', 2) },
        ]),
      {
        cashChecks: [
          {
            id: 'PETTY-FIXTURE',
            status: 'UNKNOWN',
            currency: null,
            error: null,
          },
        ],
      },
    );
    await expect(
      handler.execute({ batchId: 'batch-1' } as never),
    ).rejects.toThrow(BadRequestException);
    expect(queueService.addDurableJob).not.toHaveBeenCalled();
    expect(dataBatchService.updateStatusAsync).not.toHaveBeenCalled();
  });

  it('blocks the post when the cash account is bank-only', async () => {
    const { handler, queueService } = buildHandler(
      completeConfig(),
      () =>
        records([
          { id: 'r1', journal: 'MASREV-202610-001', raw: raw('0012', 2) },
        ]),
      {
        cashChecks: [
          {
            id: 'PETTY-FIXTURE',
            status: 'BANK_ONLY',
            currency: null,
            error: null,
          },
        ],
      },
    );
    await expect(
      handler.execute({ batchId: 'batch-1' } as never),
    ).rejects.toThrow(/Posting is blocked by MAS cash-account checks/);
    expect(queueService.addDurableJob).not.toHaveBeenCalled();
  });

  it('fails closed when no cash-account verifier is available', async () => {
    const { handler, queueService } = buildHandler(
      completeConfig(),
      () =>
        records([
          { id: 'r1', journal: 'MASREV-202610-001', raw: raw('0012', 2) },
        ]),
      { noVerifier: true },
    );
    await expect(
      handler.execute({ batchId: 'batch-1' } as never),
    ).rejects.toThrow(/cash-account verification is not available/);
    expect(queueService.addDurableJob).not.toHaveBeenCalled();
  });

  it('checks the configured cash IDs at posting time (not only at submit)', async () => {
    const { handler, cashVerifier } = buildHandler(completeConfig(), () =>
      records([
        { id: 'r1', journal: 'MASREV-202610-001', raw: raw('0012', 2) },
      ]),
    );
    await handler.execute({ batchId: 'batch-1' } as never);
    expect(cashVerifier!.verify).toHaveBeenCalledWith(['PETTY-FIXTURE']);
  });
});
