import { BadRequestException } from '@nestjs/common';

import {
  BatchPostingControlError,
  BatchPostingControlService,
} from './batch-posting-control.service';

import { SetBatchPostingPauseHandler } from '@/modules/data-batch/commands/handlers/set-batch-posting-pause.handler';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DurableQueueJobStatus } from '@/modules/queue/schemas/queue-job.schema';

const actor = { id: 'u1', name: 'Ops User', email: 'ops@example.com' };

function buildService(options?: {
  batch?: Record<string, unknown>;
  job?: Record<string, unknown> | null;
}) {
  const batch = {
    id: 'batch-1',
    status: DataBatchStatus.Posting,
    postingPaused: false,
    ...options?.batch,
  };

  const batches = {
    getByIdAsync: jest.fn().mockResolvedValue(batch),
    isPostingPausedAsync: jest.fn().mockResolvedValue(batch.postingPaused),
    listPostingPausedIdsAsync: jest.fn().mockResolvedValue([]),
    setPostingPauseAsync: jest.fn((batchId: string, paused: boolean) =>
      Promise.resolve({ ...batch, postingPaused: paused }),
    ),
  };

  const job =
    options?.job === undefined
      ? {
          jobId: 'dfo-customer-payment-journal-queue--batch-1',
          queueName: 'dfo-customer-payment-journal-queue',
          jobName: 'post-customer-payment-journal-dfo',
          batchId: 'batch-1',
          company: 'm-p',
          correlationId: 'corr-1',
          sourceModule: 'CASH',
          payloadVersion: 2,
          cashDirection: 'out',
          status: DurableQueueJobStatus.PAUSED,
          completedGroups: 2,
          totalGroups: 5,
        }
      : options.job;

  const jobs = {
    findLatestForBatch: jest.fn().mockResolvedValue(job),
    listByStatuses: jest.fn().mockResolvedValue(job ? [job] : []),
    listOpenForBatch: jest.fn().mockResolvedValue(job ? [job] : []),
    markPaused: jest.fn().mockResolvedValue(undefined),
    markQueued: jest.fn().mockResolvedValue(undefined),
    purgeJob: jest.fn().mockResolvedValue(undefined),
    purgeByBatch: jest.fn().mockResolvedValue(1),
  };

  const queues = {
    requeueDurableJob: jest.fn().mockResolvedValue('requeued'),
    findRunningJobsForBatch: jest.fn().mockResolvedValue([]),
    removeJobsForBatch: jest.fn().mockResolvedValue([]),
  };

  const logs = { emit: jest.fn().mockResolvedValue(undefined) };

  const service = new BatchPostingControlService(
    batches as any,
    jobs as any,
    queues as any,
    logs as any,
  );

  return { service, batches, jobs, queues, logs };
}

describe('BatchPostingControlService', () => {
  it('flags the batch so the running worker stops after its current journal', async () => {
    const { service, batches, logs } = buildService({
      job: {
        jobId: 'job-1',
        queueName: 'dfo-customer-payment-journal-queue',
        jobName: 'post',
        batchId: 'batch-1',
        company: 'm-p',
        correlationId: 'corr-1',
        sourceModule: 'CASH',
        payloadVersion: 2,
        status: DurableQueueJobStatus.ACTIVE,
        completedGroups: 1,
        totalGroups: 4,
      },
    });

    const state = await service.pause('batch-1', actor);

    expect(batches.setPostingPauseAsync).toHaveBeenCalledWith(
      'batch-1',
      true,
      expect.objectContaining({ userId: 'u1', userEmail: 'ops@example.com' }),
    );
    expect(state.paused).toBe(true);
    expect(state.stopping).toBe(true);
    expect(state.message).toContain('currently writing');
    expect(logs.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'batch.posting.paused' }),
    );
  });

  it('refuses to pause a batch that is already posted', async () => {
    const { service, batches } = buildService({
      batch: { status: DataBatchStatus.Posted },
    });

    await expect(service.pause('batch-1', actor)).rejects.toBeInstanceOf(
      BatchPostingControlError,
    );
    expect(batches.setPostingPauseAsync).not.toHaveBeenCalled();
  });

  it('leaves an already paused batch untouched', async () => {
    const { service, batches } = buildService({
      batch: { postingPaused: true },
    });

    const state = await service.pause('batch-1', actor);

    expect(state.paused).toBe(true);
    expect(batches.setPostingPauseAsync).not.toHaveBeenCalled();
  });

  it('puts the stopped job back on its queue when posting resumes', async () => {
    const { service, batches, jobs, queues } = buildService({
      batch: { postingPaused: true },
    });

    const state = await service.resume('batch-1', actor);

    expect(batches.setPostingPauseAsync).toHaveBeenCalledWith(
      'batch-1',
      false,
      expect.objectContaining({ userId: 'u1' }),
    );
    expect(queues.requeueDurableJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'dfo-customer-payment-journal-queue--batch-1',
        batchId: 'batch-1',
        payloadVersion: 2,
      }),
    );
    expect(jobs.markQueued).toHaveBeenCalledWith(
      'dfo-customer-payment-journal-queue--batch-1',
    );
    expect(state.paused).toBe(false);
    expect(state.message).toContain('remaining journals are queued again');
  });

  it('only clears the flag when the batch was paused before posting started', async () => {
    const { service, queues, jobs } = buildService({
      batch: { postingPaused: true, status: DataBatchStatus.PendingPosting },
      job: null,
    });

    const state = await service.resume('batch-1', actor);

    expect(queues.requeueDurableJob).not.toHaveBeenCalled();
    expect(jobs.markQueued).not.toHaveBeenCalled();
    expect(state.paused).toBe(false);
  });

  it('records the worker stop without failing the batch', async () => {
    const { service, jobs, logs } = buildService();

    await service.recordWorkerStopped({
      batchId: 'batch-1',
      jobId: 'job-1',
      queueName: 'dfo-customer-payment-journal-queue',
      completedGroups: 2,
      totalGroups: 5,
    });

    expect(jobs.markPaused).toHaveBeenCalledWith('job-1');
    expect(logs.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'queue.job.paused',
        metadata: expect.objectContaining({
          completedGroups: 2,
          totalGroups: 5,
        }),
      }),
    );
  });

  it('marks an in-flight posting as stopping while its worker finishes', async () => {
    const { service, batches } = buildService({
      job: {
        jobId: 'job-1',
        queueName: 'dfo-customer-payment-journal-queue',
        batchId: 'batch-1',
        company: 'm-p',
        sourceModule: 'CASH',
        status: DurableQueueJobStatus.ACTIVE,
        completedGroups: 1,
        totalGroups: 3,
      },
    });
    batches.listPostingPausedIdsAsync.mockResolvedValue(['batch-1']);

    const [posting] = await service.listInFlight();

    expect(posting).toEqual(
      expect.objectContaining({
        batchId: 'batch-1',
        paused: true,
        stopping: true,
        completedGroups: 1,
        totalGroups: 3,
      }),
    );
  });

  it('is rejected as a bad request through the command handler', async () => {
    // The handler is the only place that turns the domain error into HTTP.
    const { service } = buildService({
      batch: { status: DataBatchStatus.Posted },
    });
    const handler = new SetBatchPostingPauseHandler(service);

    await expect(
      handler.execute({ batchId: 'batch-1', paused: true, actor } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('discards paused queue work so a batch can be deleted', async () => {
    const { service, jobs, queues, batches, logs } = buildService({
      batch: { postingPaused: true, status: DataBatchStatus.Posting },
    });
    queues.removeJobsForBatch.mockResolvedValue([
      'dfo-customer-payment-journal-queue--batch-1',
    ]);

    const result = await service.discardPostingForDelete('batch-1', actor);

    expect(queues.removeJobsForBatch).toHaveBeenCalledWith('batch-1');
    expect(jobs.purgeJob).toHaveBeenCalledWith(
      'dfo-customer-payment-journal-queue--batch-1',
    );
    // Already paused: no need to flip the flag again before purge.
    expect(batches.setPostingPauseAsync).not.toHaveBeenCalled();
    expect(result.purgedDurableJobIds).toEqual([
      'dfo-customer-payment-journal-queue--batch-1',
    ]);
    expect(logs.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'batch.posting.discarded' }),
    );
  });

  it('force-discards an active posting job so the batch can still be deleted', async () => {
    const { service, jobs, queues, batches, logs } = buildService({
      job: {
        jobId: 'job-1',
        queueName: 'dfo-customer-payment-journal-queue',
        batchId: 'batch-1',
        company: 'm-p',
        sourceModule: 'CASH',
        status: DurableQueueJobStatus.ACTIVE,
        completedGroups: 1,
        totalGroups: 3,
      },
    });
    queues.findRunningJobsForBatch.mockResolvedValue(['job-1']);
    queues.removeJobsForBatch.mockResolvedValue(['job-1']);

    const result = await service.discardPostingForDelete('batch-1', actor);

    expect(batches.setPostingPauseAsync).toHaveBeenCalledWith(
      'batch-1',
      true,
      expect.objectContaining({ userId: 'u1' }),
    );
    expect(queues.removeJobsForBatch).toHaveBeenCalledWith('batch-1');
    expect(jobs.purgeJob).toHaveBeenCalledWith('job-1');
    expect(result.removedJobIds).toEqual(['job-1']);
    expect(logs.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'batch.posting.discarded',
        metadata: expect.objectContaining({ forcedWhileRunning: true }),
      }),
    );
  });

  it('treats a missing batch as paused so a force-deleted posting stops cleanly', async () => {
    const { service, batches } = buildService();
    batches.getByIdAsync.mockResolvedValue(null);

    await expect(service.isPaused('batch-1')).resolves.toBe(true);
  });
});
