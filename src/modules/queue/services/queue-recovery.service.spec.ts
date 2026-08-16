import { QUEUES } from '@/modules/queue/constants/queues';
import { QueueRecoveryService } from '@/modules/queue/services/queue-recovery.service';
import { DurableQueueJobStatus } from '@/modules/queue/schemas/queue-job.schema';

describe(QueueRecoveryService.name, () => {
  it('releases orphaned Redis locks then restores missing durable jobs', async () => {
    const jobs = {
      listRecoverable: jest.fn().mockResolvedValue([
        {
          jobId: `${QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL}--batch-1`,
          queueName: QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL,
          jobName: 'post-customer-payment-journal-dfo',
          batchId: 'batch-1',
          company: 'm-p',
          correlationId: 'c1',
          sourceModule: 'CASH',
          payloadVersion: 2,
          cashDirection: 'out',
          status: DurableQueueJobStatus.QUEUED,
        },
      ]),
    };
    const queues = {
      releaseOrphanedActiveJobs: jest.fn().mockResolvedValue([
        {
          jobId: `${QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL}--ghost`,
          batchId: 'ghost-batch',
          mongoStatus: 'completed',
        },
      ]),
      restoreDurableJob: jest.fn().mockResolvedValue(true),
    };
    const logs = { emit: jest.fn().mockResolvedValue(undefined) };
    const service = new QueueRecoveryService(
      jobs as never,
      queues as never,
      logs as never,
    );

    const result = await service.reconcile(QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL);

    expect(queues.releaseOrphanedActiveJobs).toHaveBeenCalledWith(
      QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL,
    );
    expect(queues.restoreDurableJob).toHaveBeenCalledTimes(1);
    expect(result.released).toEqual([
      {
        queueName: QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL,
        jobId: `${QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL}--ghost`,
        batchId: 'ghost-batch',
        mongoStatus: 'completed',
      },
    ]);
    expect(result.restored).toEqual([
      `${QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL}--batch-1`,
    ]);
  });
});
