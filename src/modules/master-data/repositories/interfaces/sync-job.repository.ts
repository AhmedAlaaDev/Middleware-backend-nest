import { SyncJobStatus } from '@/modules/master-data/enums/sync-job-status.enum';
import { ISyncJob } from '@/modules/master-data/interfaces/sync-job.interface';

export abstract class SyncJobRepository {
  abstract create(name: string): Promise<ISyncJob>;
  abstract updateStatus(
    id: string,
    status: SyncJobStatus,
    errorMessage?: string,
  ): Promise<void>;
  abstract getList(): Promise<ISyncJob[]>;
  abstract findByName(name: string): Promise<ISyncJob | null>;
  abstract findById(id: string): Promise<ISyncJob | null>;
  abstract findLatestBySyncType(syncType: string): Promise<ISyncJob | null>;
  abstract hasPendingOrProcessingJob(syncType: string): Promise<boolean>;
}
