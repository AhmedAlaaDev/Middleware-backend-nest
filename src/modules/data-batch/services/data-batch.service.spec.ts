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
import { RawDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';

function createService(options?: {
  claimBatch?: boolean;
  processorFails?: boolean;
  cleanupFails?: boolean;
  duplicateBatch?: boolean;
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
    create: jest.fn().mockResolvedValue(batch),
    findBySourceFingerprint: jest
      .fn()
      .mockResolvedValue(options?.duplicateBatch ? batch : null),
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
    insertMany: jest.fn().mockResolvedValue(undefined),
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
      {
        execute: jest.fn().mockResolvedValue(undefined),
      } as unknown as CommandBus,
      {
        get: jest.fn().mockReturnValue(undefined),
      } as unknown as TraceContextService,
    ),
    dataBatchRepo,
    enhancedRepo,
    errorRepo,
    sourceRepo,
  };
}

describe(DataBatchService.name, () => {
  it('stores a source fingerprint on a newly uploaded batch', async () => {
    const harness = createService();
    const dynData = [
      {
        ErrorCount: 0,
        SourceIds: ['1'],
        GetErrors: () => [],
        GetMissingMasterData: () => [],
      },
    ];

    await harness.service.createAsync(
      EntryProcessorTypes.CashOutFreight,
      'Cash Out Freight',
      'm-p',
      'upload',
      [{ UniqueId: 1, Invoice: 'INV-1' }] as unknown as RawDataModel[],
      dynData as any,
    );

    expect(harness.dataBatchRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(harness.sourceRepo.insertMany).toHaveBeenCalledTimes(1);
  });

  it('returns the existing batch without inserting duplicate source rows', async () => {
    const harness = createService({ duplicateBatch: true });

    const result = await harness.service.createAsync(
      EntryProcessorTypes.CashOutFreight,
      'Cash Out Freight',
      'm-p',
      'duplicate upload',
      [{ UniqueId: 1, Invoice: 'INV-1' }] as unknown as RawDataModel[],
      [
        {
          ErrorCount: 0,
          SourceIds: ['1'],
          GetErrors: () => [],
          GetMissingMasterData: () => [],
        },
      ] as any,
    );

    expect(result.id).toBe('batch-1');
    expect(harness.dataBatchRepo.create).not.toHaveBeenCalled();
    expect(harness.sourceRepo.insertMany).not.toHaveBeenCalled();
    expect(harness.enhancedRepo.insertMany).not.toHaveBeenCalled();
  });

  it('resolves a concurrent duplicate-key race to the winning batch', async () => {
    const harness = createService();
    const winningBatch = await harness.dataBatchRepo.findById('batch-1');
    (harness.dataBatchRepo.findBySourceFingerprint as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winningBatch);
    (harness.dataBatchRepo.create as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: 11000 }),
    );

    const result = await harness.service.createAsync(
      EntryProcessorTypes.CashOutFreight,
      'Cash Out Freight',
      'm-p',
      'concurrent duplicate',
      [{ UniqueId: 1, Invoice: 'INV-1' }] as unknown as RawDataModel[],
      [
        {
          ErrorCount: 0,
          SourceIds: ['1'],
          GetErrors: () => [],
          GetMissingMasterData: () => [],
        },
      ] as any,
    );

    expect(result.id).toBe('batch-1');
    expect(harness.sourceRepo.insertMany).not.toHaveBeenCalled();
    expect(harness.enhancedRepo.insertMany).not.toHaveBeenCalled();
  });

  it('stores pre-format errors by source location for the existing error page', async () => {
    const harness = createService();
    const errors = [
      'Line 3 (UniqueId 466596) account: SubVendorDimensions: CostCenter: 1301 | Dimension "SubVendor" value from your file "SL-000007" was not found.',
      'Line 3 (UniqueId 466596) offset: MainAccountDimensions: Dimension "Main Account" value "223404" was not found.',
      'UniqueId 9001: all rows must use the same SafeType; found Direct, Other.',
    ];

    const result = await harness.service.createPreFormatValidationFailureAsync(
      EntryProcessorTypes.CashOutFreight,
      'Cash Out Freight',
      'm-p',
      'Cash-Out Freight validation failure',
      [{ LINENUMBER: 3, UniqueId: 466596 }] as unknown as RawDataModel[],
      errors,
    );

    expect(result.id).toBe('batch-1');
    expect(harness.dataBatchRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCount: 3,
        successCount: 0,
        totalFormattedCount: 0,
        totalUploadedCount: 1,
        status: DataBatchStatus.PendingPosting,
      }),
    );
    expect(harness.sourceRepo.insertMany).toHaveBeenCalledTimes(1);
    expect(harness.errorRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        sourceRecordIds: ['Line 3 (UniqueId 466596)'],
        enhancedRecordIds: ['3'],
        errorMessages: expect.arrayContaining([
          expect.stringContaining('Account - SubVendorDimensions'),
          expect.stringContaining('Offset - MainAccountDimensions'),
        ]),
        enhancedData: expect.objectContaining({
          LineNumber: 3,
          UniqueId: '466596',
          errors: expect.arrayContaining([
            expect.objectContaining({
              property: 'Account - SubVendorDimensions',
            }),
          ]),
        }),
      }),
      expect.objectContaining({
        sourceRecordIds: ['UniqueId 9001'],
        enhancedData: expect.objectContaining({ UniqueId: '9001' }),
      }),
    ]);
  });

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
