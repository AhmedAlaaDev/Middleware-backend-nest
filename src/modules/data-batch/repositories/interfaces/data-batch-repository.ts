import {
  ICreateDataBatch,
  IDataBatch,
  IUpdateDataBatch,
  IDataBatchListFilter,
} from '@/modules/data-batch/interfaces/data-batch.interface';

export abstract class DataBatchRepository {
  abstract create(dataBatch: ICreateDataBatch): Promise<IDataBatch>;
  abstract deleteOne(batchId: string): Promise<void>;
  abstract findById(batchId: string): Promise<IDataBatch | null>;
  abstract findBySourceFingerprint(
    company: string,
    entryProcessorType: number,
    sourceFingerprint: string,
  ): Promise<IDataBatch | null>;
  abstract updateOne(batchId: string, data: IUpdateDataBatch): Promise<void>;
  abstract claimForRevalidation(batchId: string): Promise<IDataBatch | null>;
  /** Cheap read used by the posting workers between journals. */
  abstract isPostingPaused(batchId: string): Promise<boolean>;
  /** Of the given batches, the ones whose posting is paused. */
  abstract listPostingPausedIds(batchIds: string[]): Promise<string[]>;
  abstract setPostingPause(
    batchId: string,
    paused: boolean,
    audit: {
      at: Date;
      userId: string;
      userName: string;
      userEmail: string;
    },
  ): Promise<IDataBatch | null>;
  abstract recordReprocessQueued(
    batchId: string,
    audit: {
      at: Date;
      userId: string;
      userName: string;
      userEmail: string;
      jobId: string;
    },
  ): Promise<void>;
  abstract getList(
    filter: IDataBatchListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IDataBatch[]>;
  abstract getCount(filter: IDataBatchListFilter): Promise<number>;
}
