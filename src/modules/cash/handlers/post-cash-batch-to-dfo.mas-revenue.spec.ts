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

  it('looks up an unmapped cash account by its sheet value, so its currency is not a blocker (the mapping gate still applies)', async () => {
    const { handler, queueService } = buildHandler(
      { ...completeConfig(), cashAccountIdsByDisplayName: {} },
      () =>
        records([
          {
            id: 'r1',
            journal: 'MASREV-202610-001',
            raw: { ...raw('0012', 2), Currency: '' },
          },
        ]),
    );

    const error = await handler
      .execute({ batchId: 'batch-1' } as never)
      .catch((e: unknown) => e);
    const errors = (error as { response: { errors: string[] } }).response
      .errors;
    expect(errors.join(' ')).toContain('unknown or unsupported cash account');
    expect(errors.join(' ')).not.toContain('currency is not resolved');
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

describe('PostCashBatchToDFOHandler: MAS journal lines (template version 2)', () => {
  function journalRaw(
    document: string,
    sourceRow: number,
    direction: 'in' | 'out',
  ): MasRevenueStoredRaw {
    const cashFirst = direction === 'in';
    return receiptToStoredRaw(
      {
        sourceSheet: 'Journal Lines',
        sourceRow,
        invoiceNumber: document,
        transactionDate: '2026-10-28',
        currency: '',
        valueMinor: 16500,
        vatMinor: 0,
        totalMinor: 16500,
        cashAccountDisplayName: 'Port Said',
        customerName: '',
        containerType: null,
        containerNumber: null,
        billOfLading: null,
        revenueType: null,
        seaLine: null,
        vatCardNumber: null,
        journalLine: {
          journalName: 'GL Journal',
          accountType: cashFirst ? 'RCash' : 'Ledger',
          account: cashFirst ? 'Port Said' : '524528|2401|024|002',
          offsetAccountType: cashFirst ? 'Ledger' : 'RCash',
          offsetAccount: cashFirst ? '415701|2401|024|002|005' : 'Port Said',
          side: cashFirst ? 'debit' : 'credit',
          itemSalesTaxGroup: cashFirst ? 'Tax 14' : 'NONTAXABLE',
          salesTaxGroup: '',
          postingProfile: '',
          defaultDimension: cashFirst ? '|2401|024|002|005' : '',
          offsetDefaultDimension: cashFirst ? '' : '|2401|024|002|005',
          finTag: '',
          offsetFinTag: '',
          text: '',
          requestedCurrency: '',
        },
      },
      sourceRow - 1,
    );
  }

  function buildJournalHandler(
    config: MasRevenueVerifiedConfig,
    mainExists = true,
  ) {
    const built = buildHandler(config, () =>
      records([
        {
          id: 'r1',
          journal: 'MASREV-202610-001',
          raw: journalRaw('R-1', 2, 'in'),
        },
        {
          id: 'r2',
          journal: 'MASREV-202610-001',
          raw: journalRaw('P-1', 3, 'out'),
        },
      ]),
    );
    Object.assign(built.cashVerifier!, {
      verifyMainAccounts: jest.fn(async (keys: string[]) =>
        [...new Set(keys)].map((key) => ({
          key,
          exists: mainExists,
          error: null,
        })),
      ),
      verifyItemTaxGroups: jest.fn(async (keys: string[]) =>
        [...new Set(keys)].map((key) => ({ key, exists: true, error: null })),
      ),
      readReportingRates: jest.fn(async (dates: string[]) =>
        [...new Set(dates)].map((date) => ({
          date,
          reportingExchangeRate: 1.923,
          accountingCurrency: 'EGP',
          reportingCurrency: 'USD',
          error: null,
        })),
      ),
    });
    return built;
  }

  it('queues a receipt written either way round as it was entered, in the journal the rows name', async () => {
    const { handler, queueService } = buildJournalHandler(completeConfig());

    await handler.execute({ batchId: 'batch-1' } as never);

    const groups = (queueService.addDurableJob as jest.Mock).mock
      .calls[0][3] as Array<{
      route: { journalName: string };
      header: { JournalName: string };
      lines: Array<{ customLineApiBody: Record<string, unknown> }>;
    }>;
    expect(groups).toHaveLength(1);
    expect(groups[0].route.journalName).toBe('GL Journal');
    expect(groups[0].header.JournalName).toBe('GL Journal');
    const [receipt, payment] = groups[0].lines.map((l) => l.customLineApiBody);
    expect(receipt).toMatchObject({
      accountTypeStr: 'RCash',
      AccountNum: 'Port Said',
      OffsetAccountTypeStr: 'Ledger',
      debitAmount: 165,
      creditAmount: 0,
      currency: 'EGP',
      TAXITEMGROUP: 'Tax 14',
      ReportingExchangeRate: 1.923,
    });
    expect(payment).toMatchObject({
      accountTypeStr: 'Ledger',
      AccountNum: '524528|2401|024|002',
      OffsetAccountTypeStr: 'RCash',
      offsetAccountDisplayValue: 'Port Said',
      debitAmount: 0,
      creditAmount: 165,
      TAXITEMGROUP: 'NONTAXABLE',
    });
  });

  it('blocks posting when D365 lacks a ledger account, with every reason listed', async () => {
    const { handler, queueService } = buildJournalHandler(
      completeMasRevenueConfig({
        deployedCompatibility: {
          lineServiceVerifiedForGl: false,
          glReadbackVerified: false,
        },
      }),
      false,
    );

    const error = await handler
      .execute({ batchId: 'batch-1' } as never)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as {
      errors: string[];
    };
    const text = body.errors.join(' | ');
    expect(text).toContain('ledger main account "415701" does not exist');
    expect(text).toContain('line service has not been verified');
    expect(queueService.addDurableJob).not.toHaveBeenCalled();
  });
});
