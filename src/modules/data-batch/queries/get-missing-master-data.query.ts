import { Query } from '@nestjs/cqrs';

import {
  CustomerCreationStatus,
  IDataBatchMissingMasterData,
  MissingMasterDataType,
} from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';

export class GetMissingMasterDataQuery extends Query<
  IDataBatchMissingMasterData[]
> {
  constructor(
    public readonly batchId: string,
    public readonly type?: MissingMasterDataType,
    public readonly creationStatus?: CustomerCreationStatus,
  ) {
    super();
  }
}
