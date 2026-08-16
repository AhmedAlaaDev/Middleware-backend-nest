import { PostCustomerPaymentJournalDFOProcessor } from './post-customer-payment-journal-dfo.processor';

import { CashJournalRoute } from '@/modules/cash/services/cash-journal-routing.service';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { QueueJobGroupStatus } from '@/modules/queue/schemas/queue-job-group.schema';

describe('PostCustomerPaymentJournalDFOProcessor - routed cash journals', () => {
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

  const makeGroup = (route: CashJournalRoute, lineNumber = 1) => ({
    route,
    header: {
      dataAreaId: 'm-p',
      JournalName: route.journalName,
      Description: 'Task 2045 test',
    },
    lines: [
      {
        dataAreaId: 'm-p',
        LineNumber: lineNumber,
        cashDirection: route.lineDirection,
        customLineApiBody: { journalNum: '' },
      },
    ],
  });

  const buildProcessor = (groups: any[]) => {
    const legacyStrategy = {
      setHeaderCashDirectionContext: jest.fn(),
      postHeadersInBatches: jest.fn(),
      postLinesForHeader: jest.fn(),
    };
    const cashStrategy: any = {
      setRouteContext: jest.fn(),
      postHeadersInBatches: jest
        .fn()
        .mockResolvedValueOnce({ headerIds: ['D365-RET-001'], responses: [] })
        .mockResolvedValueOnce({ headerIds: ['D365-RET-002'], responses: [] }),
      postLinesForHeader: jest.fn().mockResolvedValue([]),
      getJournalIntegrityState: jest.fn(),
      repairDuplicatedUnmarkedFallbackLines: jest.fn().mockResolvedValue(false),
      assertJournalSettlementIntegrity: jest.fn().mockResolvedValue(undefined),
    };
    cashStrategy.getJournalIntegrityState.mockImplementation(
      (headerId: string) => ({
        headerExists: true,
        lineCount:
          headerId.includes('COMPLETED') ||
          cashStrategy.postLinesForHeader.mock.calls.length > 0
            ? 1
            : 0,
        headerDescription: 'Task 2045 test',
      }),
    );
    const batches = {
      getByIdAsync: jest.fn().mockResolvedValue({ dfoIds: [] }),
      updateDfoIdsAsync: jest.fn().mockResolvedValue(undefined),
      updateDfoAttemptedIdsAsync: jest.fn().mockResolvedValue(undefined),
      clearDfoAttemptedIdsAsync: jest.fn().mockResolvedValue(undefined),
      clearDfoPostingErrorsAsync: jest.fn().mockResolvedValue(undefined),
      updateDfoPostingErrorsAsync: jest.fn().mockResolvedValue(undefined),
      updateStatusAsync: jest.fn().mockResolvedValue(undefined),
    };
    const rollback = {
      rollbackAll: jest.fn().mockResolvedValue({
        failedToDeleteHeaders: [],
      }),
    };
    const jobs = {
      prepare: jest.fn().mockResolvedValue(undefined),
      markActive: jest.fn().mockResolvedValue(undefined),
      listGroups: jest.fn().mockResolvedValue(
        groups.map((payload, index) => ({
          index,
          status: QueueJobGroupStatus.PENDING,
          payload,
        })),
      ),
      markGroupActive: jest.fn().mockResolvedValue(undefined),
      setCreatedHeader: jest.fn().mockResolvedValue(undefined),
      completeGroup: jest.fn().mockResolvedValue(undefined),
      markCompleted: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      markRetrying: jest.fn().mockResolvedValue(undefined),
      resetAfterRollback: jest.fn().mockResolvedValue(undefined),
    };
    const logs = { emit: jest.fn().mockResolvedValue(undefined) };
    const trace = {
      run: jest.fn((_context, callback) => callback()),
    };
    const pauseControl = {
      isPaused: jest.fn().mockResolvedValue(false),
      recordWorkerStopped: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new PostCustomerPaymentJournalDFOProcessor(
      legacyStrategy as any,
      cashStrategy,
      batches as any,
      jobs as any,
      logs as any,
      trace as any,
      pauseControl as any,
    );
    const job = {
      id: 'job-2045',
      name: 'post-customer-payment-journal-dfo',
      data: {
        batchId: 'batch-2045',
        company: 'm-p',
        correlationId: 'corr-2045',
        sourceModule: 'CASH',
        payloadVersion: 2,
        cashDirection: 'out',
      },
      attemptsMade: 0,
      opts: { attempts: 1 },
      updateProgress: jest.fn().mockResolvedValue(undefined),
    };

    return {
      processor,
      job,
      legacyStrategy,
      cashStrategy,
      batches,
      rollback,
      jobs,
      pauseControl,
    };
  };

  it('persists and uses the returned D365 journal number after header creation', async () => {
    const group = makeGroup(apRoute);
    const { processor, job, cashStrategy, jobs, batches } = buildProcessor([
      group,
    ]);

    await processor.process(job as any);

    expect(cashStrategy.setRouteContext).toHaveBeenCalledWith(apRoute);
    expect(cashStrategy.postHeadersInBatches).toHaveBeenCalledWith(
      [group.header],
      1,
    );
    expect(jobs.setCreatedHeader).toHaveBeenCalledWith(
      'job-2045',
      0,
      'D365-RET-001',
    );
    expect(cashStrategy.postLinesForHeader).toHaveBeenCalledWith(
      'D365-RET-001',
      group.lines,
      'm-p',
      20,
    );
    expect(
      cashStrategy.postHeadersInBatches.mock.invocationCallOrder[0],
    ).toBeLessThan(jobs.setCreatedHeader.mock.invocationCallOrder[0]);
    expect(jobs.setCreatedHeader.mock.invocationCallOrder[0]).toBeLessThan(
      cashStrategy.postLinesForHeader.mock.invocationCallOrder[0],
    );
    expect(batches.updateDfoIdsAsync).toHaveBeenCalledWith('batch-2045', [
      'D365-RET-001',
    ]);
    expect(batches.updateStatusAsync).toHaveBeenCalledWith(
      'batch-2045',
      DataBatchStatus.Posted,
    );
  });

  it('reuses the one Finance header found by the upload marker', async () => {
    const integrationMarker = 'MW:ac381037eeaa:0';
    const base = makeGroup(apRoute);
    const group = {
      ...base,
      integrationMarker,
      header: {
        ...base.header,
        Description: `Task 2045 test [${integrationMarker}]`,
      },
    };
    const { processor, job, cashStrategy, jobs } = buildProcessor([group]);
    cashStrategy.findHeadersByIntegrationMarker = jest
      .fn()
      .mockResolvedValue(['Mesco-EXISTING-001']);
    cashStrategy.getJournalIntegrityState.mockResolvedValue({
      headerExists: true,
      lineCount: group.lines.length,
      headerDescription: group.header.Description,
    });

    await processor.process(job as any);

    expect(cashStrategy.postHeadersInBatches).not.toHaveBeenCalled();
    expect(cashStrategy.postLinesForHeader).not.toHaveBeenCalled();
    expect(jobs.setCreatedHeader).toHaveBeenCalledWith(
      'job-2045',
      0,
      'Mesco-EXISTING-001',
    );
    expect(jobs.completeGroup).toHaveBeenCalledWith('job-2045', 0);
  });

  it('fails closed when the upload marker exists on duplicate Finance headers', async () => {
    const integrationMarker = 'MW:ac381037eeaa:0';
    const base = makeGroup(apRoute);
    const group = {
      ...base,
      integrationMarker,
      header: {
        ...base.header,
        Description: `Task 2045 test [${integrationMarker}]`,
      },
    };
    const { processor, job, cashStrategy, batches } = buildProcessor([group]);
    cashStrategy.findHeadersByIntegrationMarker = jest
      .fn()
      .mockResolvedValue(['Mesco-DUP-001', 'Mesco-DUP-002']);

    await expect(processor.process(job as any)).rejects.toThrow(
      'exists on multiple Finance journals',
    );

    expect(cashStrategy.postHeadersInBatches).not.toHaveBeenCalled();
    expect(cashStrategy.postLinesForHeader).not.toHaveBeenCalled();
    expect(batches.updateStatusAsync).toHaveBeenCalledWith(
      'batch-2045',
      DataBatchStatus.Canceled,
    );
  });

  it('prevents a new header when Finance already owns a requested settlement', async () => {
    const group = makeGroup(apRoute);
    const { processor, job, cashStrategy } = buildProcessor([group]);
    cashStrategy.findHeadersByIntegrationMarker = jest
      .fn()
      .mockResolvedValue([]);
    cashStrategy.assertNoExternalSettlementOwners = jest
      .fn()
      .mockRejectedValue(
        new Error(
          '[DATA INTEGRITY] Cannot create a new cash journal because Finance already owns requested settlement mark(s)',
        ),
      );

    await expect(processor.process(job as any)).rejects.toThrow(
      'already owns requested settlement mark',
    );

    expect(cashStrategy.postHeadersInBatches).not.toHaveBeenCalled();
    expect(cashStrategy.postLinesForHeader).not.toHaveBeenCalled();
  });

  it('completes the group without a journal when every invoice is already settled', async () => {
    const group = makeGroup(apRoute);
    const { processor, job, cashStrategy, jobs, batches } = buildProcessor([
      group,
    ]);
    cashStrategy.findHeadersByIntegrationMarker = jest
      .fn()
      .mockResolvedValue([]);
    cashStrategy.omitAlreadySettledInvoiceGroups = jest
      .fn()
      .mockResolvedValue([]);

    await processor.process(job as any);

    expect(cashStrategy.postHeadersInBatches).not.toHaveBeenCalled();
    expect(cashStrategy.postLinesForHeader).not.toHaveBeenCalled();
    expect(jobs.completeGroup).toHaveBeenCalledWith('job-2045', 0);
    expect(jobs.markCompleted).toHaveBeenCalled();
    expect(batches.updateStatusAsync).toHaveBeenCalledWith(
      'batch-2045',
      DataBatchStatus.Posted,
    );
  });

  it('creates a journal only for UniqueId groups that are still payable', async () => {
    const settled = makeGroup(apRoute, 1);
    const open = makeGroup(apRoute, 2);
    const group = {
      ...settled,
      lines: [...settled.lines, ...open.lines],
    };
    const { processor, job, cashStrategy } = buildProcessor([group]);
    cashStrategy.findHeadersByIntegrationMarker = jest
      .fn()
      .mockResolvedValue([]);
    cashStrategy.omitAlreadySettledInvoiceGroups = jest
      .fn()
      .mockResolvedValue(open.lines);

    await processor.process(job as any);

    expect(cashStrategy.postHeadersInBatches).toHaveBeenCalledTimes(1);
    expect(cashStrategy.postLinesForHeader).toHaveBeenCalledWith(
      'D365-RET-001',
      open.lines,
      'm-p',
      20,
    );
  });

  it('does not post the batch when settlement marks are already owned in Finance', async () => {
    const first = makeGroup(apRoute, 1);
    const second = makeGroup(apRoute, 2);
    const { processor, job, cashStrategy, jobs, batches } = buildProcessor([
      first,
      second,
    ]);
    cashStrategy.assertJournalSettlementIntegrity
      .mockRejectedValueOnce(
        new Error(
          '[DATA INTEGRITY] Journal D365-RET-001 invoice settlement mismatch (0/1 expected mark(s) confirmed): line 1 expected invoice 2379790, but it is already marked by Mesco-000014835 line 1 in m-p; repair failed for line 200 invoice 18: invoice 18 has at most 0 EGP remaining, below requested 17922.03 EGP. No monetary journal lines were reposted.',
        ),
      )
      .mockResolvedValueOnce(undefined);

    await expect(processor.process(job as any)).rejects.toThrow(
      'invoice settlement mismatch',
    );

    expect(cashStrategy.postLinesForHeader).toHaveBeenCalledTimes(2);
    expect(jobs.completeGroup).toHaveBeenCalledTimes(1);
    expect(jobs.completeGroup).toHaveBeenCalledWith('job-2045', 1);
    expect(jobs.completeGroup).toHaveBeenCalledWith('job-2045', 1);
    expect(batches.updateStatusAsync).not.toHaveBeenCalledWith(
      'batch-2045',
      DataBatchStatus.Posted,
    );
  });

  it('replaces stale recovery IDs with the final verified group IDs', async () => {
    const group = makeGroup(apRoute);
    const { processor, job, cashStrategy, batches } = buildProcessor([group]);
    batches.getByIdAsync.mockResolvedValue({
      dfoIds: ['Mesco-STALE-001'],
    });

    await processor.process(job as any);

    expect(cashStrategy.postLinesForHeader).toHaveBeenCalledTimes(1);
    expect(batches.updateDfoIdsAsync).toHaveBeenLastCalledWith('batch-2045', [
      'D365-RET-001',
    ]);
  });

  it('does not post lines when D365 returns no journal number', async () => {
    const group = makeGroup(apRoute);
    const { processor, job, cashStrategy, jobs, rollback } = buildProcessor([
      group,
    ]);
    cashStrategy.postHeadersInBatches.mockReset().mockResolvedValue({
      headerIds: [],
      responses: [],
    });

    await expect(processor.process(job as any)).rejects.toThrow(
      'D365FO did not return one payment header ID',
    );

    expect(cashStrategy.postLinesForHeader).not.toHaveBeenCalled();
    expect(rollback.rollbackAll).not.toHaveBeenCalled();
    expect(jobs.resetAfterRollback).not.toHaveBeenCalled();
    expect(jobs.markFailed).toHaveBeenCalled();
  });

  it('keeps a newly created header when persisting its ID fails so finance can clean up', async () => {
    const group = makeGroup(apRoute);
    const { processor, job, cashStrategy, jobs, rollback, batches } =
      buildProcessor([group]);
    jobs.setCreatedHeader.mockRejectedValue(
      new Error('Mongo header persistence failed'),
    );

    await expect(processor.process(job as any)).rejects.toThrow(
      'Mongo header persistence failed',
    );

    expect(cashStrategy.postLinesForHeader).not.toHaveBeenCalled();
    expect(rollback.rollbackAll).not.toHaveBeenCalled();
    expect(jobs.resetAfterRollback).not.toHaveBeenCalled();
    expect(batches.updateDfoAttemptedIdsAsync).toHaveBeenCalledWith(
      'batch-2045',
      ['D365-RET-001'],
    );
  });

  it('rejects a version-2 group that has no task-2045 route metadata', async () => {
    const legacyGroup = {
      header: {
        dataAreaId: 'm-p',
        JournalBatchNumber: 'Mesco-000000001',
        JournalName: 'P-Freight',
        Description: 'Legacy group',
      },
      lines: [],
    };
    const { processor, job, cashStrategy, legacyStrategy } = buildProcessor([
      legacyGroup,
    ]);

    await expect(processor.process(job as any)).rejects.toThrow(
      'payload version 2 requires route metadata',
    );

    expect(cashStrategy.postHeadersInBatches).not.toHaveBeenCalled();
    expect(legacyStrategy.postHeadersInBatches).not.toHaveBeenCalled();
  });

  it('keeps earlier journals when a later route fails so retry can resume', async () => {
    const groups = [makeGroup(apRoute, 1), makeGroup(glRoute, 2)];
    const { processor, job, cashStrategy, rollback, jobs, batches } =
      buildProcessor(groups);
    cashStrategy.postLinesForHeader
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('second route failed'));

    await expect(processor.process(job as any)).rejects.toThrow(
      'second route failed',
    );

    expect(
      cashStrategy.setRouteContext.mock.calls.map((call) => call[0]),
    ).toEqual([apRoute, glRoute]);
    expect(jobs.completeGroup).toHaveBeenCalledWith('job-2045', 0);
    expect(rollback.rollbackAll).not.toHaveBeenCalled();
    expect(jobs.resetAfterRollback).not.toHaveBeenCalled();
    expect(batches.updateDfoAttemptedIdsAsync).toHaveBeenCalledWith(
      'batch-2045',
      ['D365-RET-001', 'D365-RET-002'],
    );
  });

  it('reuses a persisted header on recovery without creating a second header', async () => {
    const group = makeGroup(glRoute);
    const { processor, job, cashStrategy, jobs } = buildProcessor([group]);
    jobs.listGroups.mockResolvedValue([
      {
        index: 0,
        status: QueueJobGroupStatus.ACTIVE,
        createdHeaderId: 'D365-PERSISTED-GL',
        payload: group,
      },
    ]);

    await processor.process(job as any);

    expect(cashStrategy.postHeadersInBatches).not.toHaveBeenCalled();
    expect(cashStrategy.postLinesForHeader).toHaveBeenCalledWith(
      'D365-PERSISTED-GL',
      group.lines,
      'm-p',
      20,
    );
  });

  it('does not post again when read-back proves the persisted journal is complete', async () => {
    const group = makeGroup(apRoute);
    const { processor, job, cashStrategy, jobs } = buildProcessor([group]);
    jobs.listGroups.mockResolvedValue([
      {
        index: 0,
        status: QueueJobGroupStatus.ACTIVE,
        createdHeaderId: 'D365-COMPLETE-AP',
        payload: group,
      },
    ]);
    cashStrategy.getJournalIntegrityState.mockResolvedValue({
      headerExists: true,
      lineCount: 1,
    });

    await processor.process(job as any);

    expect(cashStrategy.postHeadersInBatches).not.toHaveBeenCalled();
    expect(cashStrategy.postLinesForHeader).not.toHaveBeenCalled();
    expect(jobs.completeGroup).toHaveBeenCalledWith('job-2045', 0);
  });

  it('creates a fresh journal when Finance reused the persisted number for another transaction', async () => {
    const integrationMarker = 'MW:ac381037eeaa:0';
    const group = {
      ...makeGroup(apRoute),
      integrationMarker,
      header: {
        ...makeGroup(apRoute).header,
        Description: `Task 2045 test [${integrationMarker}]`,
      },
    };
    const { processor, job, cashStrategy, jobs } = buildProcessor([group]);
    jobs.listGroups.mockResolvedValue([
      {
        index: 0,
        status: QueueJobGroupStatus.ACTIVE,
        createdHeaderId: 'Mesco-000014742',
        payload: group,
      },
    ]);
    cashStrategy.getJournalIntegrityState.mockImplementation(
      (headerId: string) =>
        headerId === 'Mesco-000014742'
          ? {
              headerExists: true,
              lineCount: 15,
              headerDescription: 'Unrelated Finance transaction',
            }
          : {
              headerExists: true,
              lineCount: 1,
              headerDescription: group.header.Description,
            },
    );

    await processor.process(job as any);

    expect(cashStrategy.postHeadersInBatches).toHaveBeenCalledWith(
      [group.header],
      1,
    );
    expect(cashStrategy.postLinesForHeader).toHaveBeenCalledTimes(1);
    expect(cashStrategy.postLinesForHeader).toHaveBeenCalledWith(
      'D365-RET-001',
      group.lines,
      'm-p',
      20,
    );
    expect(jobs.setCreatedHeader).toHaveBeenCalledWith(
      'job-2045',
      0,
      'D365-RET-001',
    );
  });

  it('fails completion when the newly created Finance header loses its identity marker', async () => {
    const integrationMarker = 'MW:ac381037eeaa:0';
    const group = {
      ...makeGroup(apRoute),
      integrationMarker,
      header: {
        ...makeGroup(apRoute).header,
        Description: `Task 2045 test [${integrationMarker}]`,
      },
    };
    const { processor, job, cashStrategy, jobs } = buildProcessor([group]);
    cashStrategy.getJournalIntegrityState.mockResolvedValue({
      headerExists: true,
      lineCount: 1,
      headerDescription: 'Different transaction',
    });

    await expect(processor.process(job as any)).rejects.toThrow(
      'belongs to a different Finance transaction',
    );

    expect(jobs.completeGroup).not.toHaveBeenCalled();
  });

  it('does not complete when Finance contains extra lines', async () => {
    const group = makeGroup(apRoute);
    const { processor, job, cashStrategy, jobs, batches } = buildProcessor([
      group,
    ]);
    jobs.listGroups.mockResolvedValue([
      {
        index: 0,
        status: QueueJobGroupStatus.ACTIVE,
        createdHeaderId: 'D365-DUPLICATED-AP',
        payload: group,
      },
    ]);
    cashStrategy.getJournalIntegrityState.mockResolvedValue({
      headerExists: true,
      lineCount: 2,
    });

    await expect(processor.process(job as any)).rejects.toThrow(
      'was not confirmed in D365FO exactly once',
    );

    expect(cashStrategy.postHeadersInBatches).not.toHaveBeenCalled();
    expect(cashStrategy.postLinesForHeader).not.toHaveBeenCalled();
    expect(
      cashStrategy.repairDuplicatedUnmarkedFallbackLines,
    ).toHaveBeenCalled();
    expect(jobs.completeGroup).not.toHaveBeenCalled();
    expect(batches.updateStatusAsync).not.toHaveBeenCalledWith(
      'batch-2045',
      DataBatchStatus.Posted,
    );
  });

  it('repairs a proven 251 plus 251 D365 unmarked fallback duplication on retry', async () => {
    const integrationMarker = 'MW:1037eeaa656a:0';
    const group = {
      ...makeGroup(apRoute),
      integrationMarker,
      header: {
        ...makeGroup(apRoute).header,
        Description: `Task 2045 test [${integrationMarker}]`,
      },
    };
    const { processor, job, cashStrategy, jobs } = buildProcessor([group]);
    jobs.listGroups.mockResolvedValue([
      {
        index: 0,
        status: QueueJobGroupStatus.ACTIVE,
        createdHeaderId: 'Mesco-000014745',
        payload: group,
      },
    ]);
    cashStrategy.getJournalIntegrityState
      .mockResolvedValueOnce({
        headerExists: true,
        lineCount: 2,
        headerDescription: group.header.Description,
      })
      .mockResolvedValueOnce({
        headerExists: true,
        lineCount: 2,
        headerDescription: group.header.Description,
      })
      .mockResolvedValueOnce({
        headerExists: true,
        lineCount: 2,
        headerDescription: group.header.Description,
      })
      .mockResolvedValue({
        headerExists: true,
        lineCount: 1,
        headerDescription: group.header.Description,
      });
    cashStrategy.repairDuplicatedUnmarkedFallbackLines.mockResolvedValue(true);

    await processor.process(job as any);

    expect(
      cashStrategy.repairDuplicatedUnmarkedFallbackLines,
    ).toHaveBeenCalledWith('Mesco-000014745', 1, 'm-p');
    expect(cashStrategy.postHeadersInBatches).not.toHaveBeenCalled();
    expect(cashStrategy.postLinesForHeader).not.toHaveBeenCalled();
    expect(jobs.completeGroup).toHaveBeenCalledWith('job-2045', 0);
  });

  it('recreates a missing persisted header within the same attempt', async () => {
    const group = makeGroup(glRoute);
    const { processor, job, cashStrategy, jobs, rollback } = buildProcessor([
      group,
    ]);
    jobs.listGroups.mockResolvedValue([
      {
        index: 0,
        status: QueueJobGroupStatus.ACTIVE,
        createdHeaderId: 'Mesco-000013757',
        payload: group,
      },
    ]);
    cashStrategy.postLinesForHeader
      .mockRejectedValueOnce(
        new Error('Journal Mesco-000013757 was not found.'),
      )
      .mockResolvedValueOnce([]);

    await processor.process(job as any);

    expect(cashStrategy.postHeadersInBatches).toHaveBeenCalledWith(
      [group.header],
      1,
    );
    expect(jobs.setCreatedHeader).toHaveBeenCalledWith(
      'job-2045',
      0,
      'D365-RET-001',
    );
    expect(cashStrategy.postLinesForHeader.mock.calls).toEqual([
      ['Mesco-000013757', group.lines, 'm-p', 20],
      ['D365-RET-001', group.lines, 'm-p', 20],
    ]);
    expect(rollback.rollbackAll).not.toHaveBeenCalled();
    expect(jobs.resetAfterRollback).not.toHaveBeenCalled();
  });

  it('recreates again when SpecTrans self-cite deletes the replacement header', async () => {
    const group = makeGroup(apRoute);
    const { processor, job, cashStrategy, jobs, rollback } = buildProcessor([
      group,
    ]);
    jobs.listGroups.mockResolvedValue([
      {
        index: 0,
        status: QueueJobGroupStatus.ACTIVE,
        createdHeaderId: 'Mesco-000014387',
        payload: group,
      },
    ]);
    cashStrategy.postHeadersInBatches.mockReset();
    cashStrategy.postHeadersInBatches
      .mockResolvedValueOnce({
        headerIds: ['Mesco-000014388'],
        responses: [],
      })
      .mockResolvedValueOnce({
        headerIds: ['Mesco-000014389'],
        responses: [],
      });
    cashStrategy.postLinesForHeader.mockReset();
    cashStrategy.postLinesForHeader
      .mockRejectedValueOnce(
        new Error('Journal Mesco-000014387 was not found.'),
      )
      .mockRejectedValueOnce(
        new Error('Journal Mesco-000014388 was not found.'),
      )
      .mockResolvedValueOnce([]);

    await processor.process(job as any);

    expect(cashStrategy.postHeadersInBatches).toHaveBeenCalledTimes(2);
    expect(cashStrategy.postLinesForHeader.mock.calls).toEqual([
      ['Mesco-000014387', group.lines, 'm-p', 20],
      ['Mesco-000014388', group.lines, 'm-p', 20],
      ['Mesco-000014389', group.lines, 'm-p', 20],
    ]);
    expect(jobs.setCreatedHeader).toHaveBeenLastCalledWith(
      'job-2045',
      0,
      'Mesco-000014389',
    );
    expect(rollback.rollbackAll).not.toHaveBeenCalled();
  });

  it('leaves a header completed by an earlier attempt intact when a later route fails', async () => {
    const completedAp = makeGroup(apRoute, 1);
    const pendingGl = makeGroup(glRoute, 1);
    const { processor, job, cashStrategy, rollback, jobs, batches } =
      buildProcessor([completedAp, pendingGl]);
    jobs.listGroups.mockResolvedValue([
      {
        index: 0,
        status: QueueJobGroupStatus.COMPLETED,
        createdHeaderId: 'D365-COMPLETED-AP',
        payload: completedAp,
      },
      {
        index: 1,
        status: QueueJobGroupStatus.PENDING,
        payload: pendingGl,
      },
    ]);
    cashStrategy.postHeadersInBatches.mockReset().mockResolvedValue({
      headerIds: ['D365-NEW-GL'],
      responses: [],
    });
    cashStrategy.postLinesForHeader.mockRejectedValue(
      new Error('GL line failed'),
    );

    await expect(processor.process(job as any)).rejects.toThrow(
      'GL line failed',
    );

    expect(cashStrategy.postHeadersInBatches).toHaveBeenCalledTimes(1);
    expect(rollback.rollbackAll).not.toHaveBeenCalled();
    expect(jobs.resetAfterRollback).not.toHaveBeenCalled();
    expect(batches.updateDfoAttemptedIdsAsync).toHaveBeenCalledWith(
      'batch-2045',
      ['D365-NEW-GL'],
    );
  });

  it('reuses the persisted header on retry without clearing completed journals', async () => {
    const completedAp = makeGroup(apRoute, 1);
    const pendingGl = makeGroup(glRoute, 2);
    const { processor, job, cashStrategy, jobs, rollback } = buildProcessor([
      completedAp,
      pendingGl,
    ]);
    jobs.listGroups.mockResolvedValue([
      {
        index: 0,
        status: QueueJobGroupStatus.COMPLETED,
        createdHeaderId: 'D365-COMPLETED-AP',
        payload: completedAp,
      },
      {
        index: 1,
        status: QueueJobGroupStatus.ACTIVE,
        createdHeaderId: 'D365-PERSISTED-GL',
        payload: pendingGl,
      },
    ]);

    await processor.process(job as any);

    expect(cashStrategy.postHeadersInBatches).not.toHaveBeenCalled();
    expect(cashStrategy.postLinesForHeader).toHaveBeenCalledTimes(1);
    expect(cashStrategy.postLinesForHeader).toHaveBeenCalledWith(
      'D365-PERSISTED-GL',
      pendingGl.lines,
      'm-p',
      20,
    );
    expect(jobs.completeGroup).toHaveBeenCalledWith('job-2045', 1);
    expect(rollback.rollbackAll).not.toHaveBeenCalled();
    expect(jobs.resetAfterRollback).not.toHaveBeenCalled();
  });

  it('posts nothing when the batch is paused before the first journal', async () => {
    const {
      processor,
      job,
      cashStrategy,
      batches,
      jobs,
      rollback,
      pauseControl,
    } = buildProcessor([makeGroup(apRoute)]);
    pauseControl.isPaused.mockResolvedValue(true);

    await processor.process(job as any);

    expect(cashStrategy.postHeadersInBatches).not.toHaveBeenCalled();
    expect(pauseControl.recordWorkerStopped).toHaveBeenCalledWith({
      batchId: 'batch-2045',
      jobId: 'job-2045',
      queueName: 'dfo-customer-payment-journal-queue',
      completedGroups: 0,
      totalGroups: 1,
    });
    // A pause is not a failure: nothing is rolled back and the batch keeps its
    // Posting status so it can be resumed.
    expect(rollback.rollbackAll).not.toHaveBeenCalled();
    expect(jobs.markCompleted).not.toHaveBeenCalled();
    expect(jobs.markFailed).not.toHaveBeenCalled();
    expect(batches.updateStatusAsync).not.toHaveBeenCalled();
  });

  it('keeps the journals it already posted when paused part way through', async () => {
    const groups = [makeGroup(apRoute, 1), makeGroup(glRoute, 2)];
    const { processor, job, cashStrategy, batches, jobs, pauseControl } =
      buildProcessor(groups);
    pauseControl.isPaused
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await processor.process(job as any);

    expect(cashStrategy.postLinesForHeader).toHaveBeenCalledTimes(1);
    expect(jobs.completeGroup).toHaveBeenCalledWith('job-2045', 0);
    expect(pauseControl.recordWorkerStopped).toHaveBeenCalledWith(
      expect.objectContaining({ completedGroups: 1, totalGroups: 2 }),
    );
    expect(batches.updateStatusAsync).not.toHaveBeenCalled();
  });
});
