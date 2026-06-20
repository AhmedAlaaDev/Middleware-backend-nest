import { Query } from '@nestjs/cqrs';

import {
  type IMissingMasterDataPaginatedResponse,
  CustomerCreationStatus,
  MissingMasterDataType,
} from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';

export class GetMissingMasterDataQuery extends Query<IMissingMasterDataPaginatedResponse> {
  constructor(
    public readonly batchId: string,
    public readonly type?: MissingMasterDataType,
    public readonly creationStatus?: CustomerCreationStatus,
    public readonly page: number = 1,
    public readonly limit: number = 30,
    public readonly search?: string,
  ) {
    super();
  }
}
