import { SetMetadata } from '@nestjs/common';

export type BatchOwnerAction = 'reprocess' | 'delete';
export const BATCH_OWNER_ACTION = 'batchOwnerAction';

export const RequireBatchOwnerOrAdmin = (action: BatchOwnerAction) =>
  SetMetadata(BATCH_OWNER_ACTION, action);
