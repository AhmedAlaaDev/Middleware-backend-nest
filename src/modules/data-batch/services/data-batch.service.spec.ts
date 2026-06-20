/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { ConflictException } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';
import {
  DataBatchErrorRepository,
  DataBatchMissingMasterDataRepository,
  DataBatchRepository,
  DataEnhancedRecordRepository,
  DataSourceRecordRepository,
} from '@/modules/data-batch/repositories/interfaces';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';

function createService(options?: {
  claimBatch?: boolean;
  processorFails?: boolean;
  cleanupFails?: boolean;
}) {
  const batch = {
    id: 'batch-1',
    company: 'Saco',
    entryProcessorType: EntryProcessorTypes.AccountReceivableFreight,
    entryProcessorName: 'AR',
    successCount: 1,
    errorCount: 1,
    totalFormattedCount: 2,
    totalUploadedCount: 2,
    status: DataBatchStatus.Revalidating,
    activeValidationRunId: 'old-run',
    creationDate: new Date(),
  };
  const dataBatchRepo = {
    claimForRevalidation: jest
      .fn()
      .mockResolvedValue(options?.claimBatch === false ? null : batch),
    findById: jest.fn().mockResolvedValue(batch),
    updateOne: jest.fn().mockResolvedValue(undefined),
  } as unknown as DataBatchRepository;
  const deleteRun = jest.fn(
    async (_batchId: string, validationRunId?: string) => {
      if (options?.cleanupFails && validationRunId === 'old-run') {
        throw new Error('cleanup failed');
      }
    },
  );
  const enhancedRepo = {
    deleteMany: deleteRun,
    insertMany: jest.fn().mockResolvedValue(undefined),
  } as unknown as DataEnhancedRecordRepository;
  const errorRepo = {
    deleteMany: deleteRun,
    insertMany: jest.fn().mockResolvedValue(undefined),
  } as unknown as DataBatchErrorRepository;
  const sourceRepo = {
    getList: jest
      .fn()
      .mockResolvedValue([
        { id: 'source-1', batchId: 'batch-1', data: { id: 1 } },
      ]),
  } as unknown as DataSourceRecordRepository;
  const formattedRecord = {
    ErrorCount: 0,
    SourceIds: ['source-1'],
    GetErrors: () => [],
    GetMissingMasterData: () => [],
  };
  const processor = {
    formatAndEnrichAsync:
      options?.processorFails === false
        ? jest.fn().mockResolvedValue([formattedRecord])
        : jest.fn().mockRejectedValue(new Error('processor failed')),
    validateAsync: jest.fn().mockResolvedValue([formattedRecord]),
  };
  const processorFactory = {
    getProcessor: jest.fn().mockReturnValue({
      ...processor,
    }),
  } as unknown as EntryProcessorFactory;
  const missingRepo = {
    getList: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue(undefined),
    updateOne: jest.fn().mockResolvedValue(undefined),
  } as unknown as DataBatchMissingMasterDataRepository;

  return {
    service: new DataBatchService(
      dataBatchRepo,
      errorRepo,
      sourceRepo,
      enhancedRepo,
      missingRepo,
      processorFactory,
      {} as CommandBus,
    ),
    dataBatchRepo,
    enhancedRepo,
    errorRepo,
  };
}

describe(DataBatchService.name, () => {
  it('keeps the active validation run when replacement processing fails', async () => {
    const harness = createService();

    await expect(
      harness.service.reprocessBatchAsync('batch-1'),
    ).rejects.toThrow('processor failed');

    expect(harness.enhancedRepo.deleteMany).not.toHaveBeenCalled();
    expect(harness.errorRepo.deleteMany).not.toHaveBeenCalled();
    expect(harness.dataBatchRepo.updateOne).toHaveBeenCalledWith('batch-1', {
      status: DataBatchStatus.PendingPosting,
    });
  });

  it('rejects a concurrent reprocessing claim', async () => {
    const harness = createService({ claimBatch: false });

    await expect(
      harness.service.reprocessBatchAsync('batch-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.dataBatchRepo.updateOne).not.toHaveBeenCalled();
  });

  it('keeps the committed replacement active when old-run cleanup fails', async () => {
    const harness = createService({
      processorFails: false,
      cleanupFails: true,
    });

    await expect(
      harness.service.reprocessBatchAsync('batch-1'),
    ).resolves.toBeUndefined();

    expect(harness.dataBatchRepo.updateOne).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({
        activeValidationRunId: expect.any(String),
        status: DataBatchStatus.PendingPosting,
      }),
    );
    expect(harness.enhancedRepo.deleteMany).toHaveBeenCalledTimes(2);
    expect(harness.enhancedRepo.deleteMany).toHaveBeenCalledWith(
      'batch-1',
      'old-run',
    );
  });
});
