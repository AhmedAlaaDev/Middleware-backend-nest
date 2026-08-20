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
    const cashStrategy = {
      setRouteContext: jest.fn(),
      postHeadersInBatches: jest
        .fn()
        .mockResolvedValueOnce({ headerIds: ['D365-RET-001'], responses: [] })
        .mockResolvedValueOnce({ headerIds: ['D365-RET-002'], responses: [] }),
      postLinesForHeader: jest.fn().mockResolvedValue([]),
    };
    const batches = {
      getByIdAsync: jest.fn().mockResolvedValue({ dfoIds: [] }),
      updateDfoIdsAsync: jest.fn().mockResolvedValue(undefined),
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
      cashStrategy as any,
      batches as any,
      rollback as any,
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

  it('does not post lines when D365 returns no journal number', async () => {
    const group = makeGroup(apRoute);
    const { processor, job, cashStrategy, jobs } = buildProcessor([group]);
    cashStrategy.postHeadersInBatches.mockReset().mockResolvedValue({
      headerIds: [],
      responses: [],
    });

    await expect(processor.process(job as any)).rejects.toThrow(
      'D365FO did not return one payment header ID',
    );

    expect(cashStrategy.postLinesForHeader).not.toHaveBeenCalled();
    expect(jobs.resetAfterRollback).toHaveBeenCalledWith('job-2045', []);
    expect(jobs.markFailed).toHaveBeenCalled();
  });

  it('rolls back a newly created header when persisting its ID fails', async () => {
    const group = makeGroup(apRoute);
    const { processor, job, cashStrategy, jobs, rollback } = buildProcessor([
      group,
    ]);
    jobs.setCreatedHeader.mockRejectedValue(
      new Error('Mongo header persistence failed'),
    );

    await expect(processor.process(job as any)).rejects.toThrow(
      'Mongo header persistence failed',
    );

    expect(cashStrategy.postLinesForHeader).not.toHaveBeenCalled();
    expect(rollback.rollbackAll).toHaveBeenCalledWith(
      cashStrategy,
      [
        expect.objectContaining({
          headerKey: 'D365-RET-001',
          route: apRoute,
        }),
      ],
      20,
      expect.anything(),
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

  it('restores each route context in reverse order during rollback', async () => {
    const groups = [makeGroup(apRoute, 1), makeGroup(glRoute, 2)];
    const { processor, job, cashStrategy, rollback } = buildProcessor(groups);
    cashStrategy.postLinesForHeader
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('second route failed'));

    await expect(processor.process(job as any)).rejects.toThrow(
      'second route failed',
    );

    expect(
      cashStrategy.setRouteContext.mock.calls.map((call) => call[0]),
    ).toEqual([apRoute, glRoute, glRoute, apRoute]);
    expect(rollback.rollbackAll).toHaveBeenCalledTimes(2);
    expect(rollback.rollbackAll.mock.calls[0][1][0]).toMatchObject({
      headerKey: 'D365-RET-002',
      route: glRoute,
    });
    expect(rollback.rollbackAll.mock.calls[1][1][0]).toMatchObject({
      headerKey: 'D365-RET-001',
      route: apRoute,
    });
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

  it('rolls back a header completed by an earlier attempt if a later route fails', async () => {
    const completedAp = makeGroup(apRoute, 1);
    const pendingGl = makeGroup(glRoute, 1);
    const { processor, job, cashStrategy, rollback, jobs } = buildProcessor([
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

    expect(rollback.rollbackAll).toHaveBeenCalledTimes(2);
    expect(rollback.rollbackAll.mock.calls[0][1][0]).toMatchObject({
      headerKey: 'D365-NEW-GL',
      route: glRoute,
    });
    expect(rollback.rollbackAll.mock.calls[1][1][0]).toMatchObject({
      headerKey: 'D365-COMPLETED-AP',
      route: apRoute,
    });
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
