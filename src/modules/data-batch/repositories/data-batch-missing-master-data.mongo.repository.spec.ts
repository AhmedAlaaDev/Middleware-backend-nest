import { Model } from 'mongoose';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchMissingMasterDataMongoRepository } from '@/modules/data-batch/repositories/data-batch-missing-master-data.mongo.repository';
import { DataBatchMissingMasterData } from '@/modules/data-batch/schemas/data-batch-missing-master-data.schema';

describe(DataBatchMissingMasterDataMongoRepository.name, () => {
  it('maps Mongo _id to the frontend id contract', async () => {
    const document = {
      _id: { toString: () => 'mongo-id' },
      batchId: 'batch-1',
      company: 'Saco',
      entryProcessorType: EntryProcessorTypes.AccountReceivableFreight,
      type: 'customer',
      missingField: 'CustomerAccount',
      missingValue: 'C-100',
      creationStatus: 'missing',
      reprocessStatus: 'not_started',
      affectedCount: 2,
      readonlyFormFields: ['CustomerAccount'],
      reprocessAttempts: 0,
    };
    const model = {
      find: jest.fn(() => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue([document]),
        }),
      })),
    } as unknown as Model<DataBatchMissingMasterData>;
    const repository = new DataBatchMissingMasterDataMongoRepository(model);

    const [result] = await repository.getList('batch-1');

    expect(result.id).toBe('mongo-id');
    expect(result).not.toHaveProperty('_id');
  });
});
