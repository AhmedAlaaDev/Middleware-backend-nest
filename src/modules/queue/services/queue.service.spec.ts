/* eslint-disable @typescript-eslint/unbound-method */
import { Queue } from 'bullmq';

import { QUEUES } from '@/modules/queue/constants/queues';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';
import { QueueService } from '@/modules/queue/services/queue.service';

describe(QueueService.name, () => {
  it('keeps a large posting payload out of Redis and applies durable retry options', async () => {
    const redisQueue = {
      getJob: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue({
        id: `${QUEUES.DFO_LEDGER_JOURNAL}--batch-42`,
      }),
    } as unknown as Queue;
    const jobStore = {
      prepare: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueueJobStoreService;
    const operationalLogs = {
      emit: jest.fn().mockResolvedValue(undefined),
    };
    const traceContext = {
      get: () => ({ correlationId: 'request-7' }),
    };
    const service = new QueueService(
      {} as Queue,
      {} as Queue,
      {} as Queue,
      redisQueue,
      {} as Queue,
      {} as Queue,
      jobStore,
      operationalLogs as never,
      traceContext as never,
    );
    const groups = Array.from({ length: 30_000 }, (_, index) => ({
      header: { id: index },
      lines: [{ index }],
    }));

    const submission = await service.addDurableJob(
      QUEUES.DFO_LEDGER_JOURNAL,
      'post-ledger',
      {
        batchId: 'batch-42',
        company: 'm-p',
        sourceModule: 'Ledger',
        payloadVersion: 2,
      },
      groups,
    );

    const [, redisPayload, options] = (redisQueue.add as jest.Mock).mock
      .calls[0];
    expect(redisPayload).toEqual({
      batchId: 'batch-42',
      company: 'm-p',
      correlationId: 'request-7',
      sourceModule: 'Ledger',
      payloadVersion: 2,
      journalKind: undefined,
      cashDirection: undefined,
    });
    expect(JSON.stringify(redisPayload).length).toBeLessThan(500);
    expect(options).toMatchObject({
      jobId: `${QUEUES.DFO_LEDGER_JOURNAL}--batch-42`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });
    expect(submission.status).toBe('queued');
  });

  it('removes and replaces a failed deterministic job before requeueing', async () => {
    const failedJob = {
      getState: jest.fn().mockResolvedValue('failed'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const redisQueue = {
      getJob: jest.fn().mockResolvedValue(failedJob),
      add: jest.fn().mockResolvedValue({
        id: `${QUEUES.DFO_FREE_TEXT_INVOICE}--batch-42`,
      }),
    } as unknown as Queue;
    const jobStore = {
      prepare: jest.fn(),
      replace: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueueJobStoreService;
    const service = new QueueService(
      redisQueue,
      {} as Queue,
      {} as Queue,
      {} as Queue,
      {} as Queue,
      {} as Queue,
      jobStore,
      { emit: jest.fn().mockResolvedValue(undefined) } as never,
      { get: () => ({ correlationId: 'request-8' }) } as never,
    );

    const submission = await service.addDurableJob(
      QUEUES.DFO_FREE_TEXT_INVOICE,
      'post-free-text',
      {
        batchId: 'batch-42',
        company: 'm-p',
        sourceModule: 'AR',
        payloadVersion: 1,
      },
      [{ header: { id: 1 }, lines: [] }],
    );

    expect(failedJob.remove).toHaveBeenCalled();
    expect(jobStore.replace).toHaveBeenCalled();
    expect(redisQueue.add).toHaveBeenCalled();
    expect(submission.status).toBe('requeued');
  });

  it('reports an existing completed job without claiming it was queued', async () => {
    const completedJob = {
      id: `${QUEUES.DFO_FREE_TEXT_INVOICE}--batch-42`,
      getState: jest.fn().mockResolvedValue('completed'),
    };
    const redisQueue = {
      getJob: jest.fn().mockResolvedValue(completedJob),
      add: jest.fn(),
    } as unknown as Queue;
    const service = new QueueService(
      redisQueue,
      {} as Queue,
      {} as Queue,
      {} as Queue,
      {} as Queue,
      {} as Queue,
      { prepare: jest.fn(), replace: jest.fn() } as never,
      { emit: jest.fn().mockResolvedValue(undefined) } as never,
      { get: () => ({ correlationId: 'request-9' }) } as never,
    );

    const submission = await service.addDurableJob(
      QUEUES.DFO_FREE_TEXT_INVOICE,
      'post-free-text',
      {
        batchId: 'batch-42',
        company: 'm-p',
        sourceModule: 'AR',
        payloadVersion: 1,
      },
      [{ header: { id: 1 }, lines: [] }],
    );

    expect(submission).toMatchObject({
      job: completedJob,
      status: 'already-completed',
      redisState: 'completed',
    });
    expect(redisQueue.add).not.toHaveBeenCalled();
  });
});
