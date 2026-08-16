import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';

export interface ICreateDataBatch {
  company: string;
  entryProcessorType: EntryProcessorTypes;
  entryProcessorName: string;
  description: string;
  successCount: number;
  errorCount: number;
  totalFormattedCount: number;
  totalUploadedCount: number;
  withholdingRemovedCount: number;
  withholdingRemovedAmount: number;
  status: DataBatchStatus;
  billingCodeId: string | undefined;
  expectedGroupCount?: number;
  activeValidationRunId?: string;
  /** SHA-256 of the canonical uploaded source rows, used for idempotency. */
  sourceFingerprint?: string;
  dfoIds?: string[];
  dfoAttemptedIds?: string[];
  dfoPostingErrors?: string[];
  createdByUserId?: string;
  createdByName?: string;
  createdByEmail?: string;
  postingPaused?: boolean;
  postingPausedAt?: Date;
  postingPausedByUserId?: string;
  postingPausedByName?: string;
  postingPausedByEmail?: string;
  postingResumedAt?: Date;
  lastReprocessedAt?: Date;
  lastReprocessedByUserId?: string;
  lastReprocessedByName?: string;
  lastReprocessedByEmail?: string;
  reprocessCount?: number;
  lastReprocessJobId?: string;
  lastReprocessStatus?: string;
  lastReprocessError?: string;
  /** Column headers in the order they appeared in the uploaded Excel file. */
  sourceColumnHeaders?: string[];
}

export type IUpdateDataBatch = Partial<ICreateDataBatch>;

export class IDataBatch {
  id: string;
  company: string;
  entryProcessorType: EntryProcessorTypes;
  entryProcessorName: string;
  description?: string;
  successCount: number;
  errorCount: number;
  totalFormattedCount: number;
  totalUploadedCount: number;
  withholdingRemovedCount: number;
  withholdingRemovedAmount: number;
  status: DataBatchStatus;
  billingCodeId?: string;
  expectedGroupCount?: number;
  activeValidationRunId?: string;
  /** SHA-256 of the canonical uploaded source rows, used for idempotency. */
  sourceFingerprint?: string;
  dfoIds?: string[];
  dfoAttemptedIds?: string[];
  dfoPostingErrors?: string[];
  createdByUserId?: string;
  createdByName?: string;
  createdByEmail?: string;
  /** True while the batch is held back from being posted to D365FO. */
  postingPaused: boolean;
  postingPausedAt?: Date;
  postingPausedByUserId?: string;
  postingPausedByName?: string;
  postingPausedByEmail?: string;
  postingResumedAt?: Date;
  lastReprocessedAt?: Date;
  lastReprocessedByUserId?: string;
  lastReprocessedByName?: string;
  lastReprocessedByEmail?: string;
  reprocessCount: number;
  lastReprocessJobId?: string;
  lastReprocessStatus?: string;
  lastReprocessError?: string;
  /** Column headers in the order they appeared in the uploaded Excel file. */
  sourceColumnHeaders?: string[];
  creationDate: Date | null;
}

export interface IDataBatchListFilter {
  entryProcessorTypes?: EntryProcessorTypes[];
  batchNumberIds?: string[];
}
