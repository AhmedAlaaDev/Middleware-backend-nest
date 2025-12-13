import { Query } from '@nestjs/cqrs';

import { SyncStatusDto } from '@/modules/master-data/dtos/sync-status.dto';

export class GetSyncStatusQuery extends Query<SyncStatusDto[]> {
  constructor() {
    super();
  }
}
