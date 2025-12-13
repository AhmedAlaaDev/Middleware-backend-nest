import { SyncJobStatus } from '@/modules/master-data/enums/sync-job-status.enum';

export interface ISyncJob {
  id: string;
  name: string;
  status: SyncJobStatus;
  errorMessage?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ICreateSyncJob {
  name: string;
  status: SyncJobStatus;
  errorMessage?: string;
}

export interface ISyncJobResponse {
  jobId: string;
  name: string;
  status: SyncJobStatus;
}
