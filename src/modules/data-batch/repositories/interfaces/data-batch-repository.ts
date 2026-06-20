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
  abstract updateOne(batchId: string, data: IUpdateDataBatch): Promise<void>;
  abstract claimForRevalidation(batchId: string): Promise<IDataBatch | null>;
  abstract getList(
    filter: IDataBatchListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IDataBatch[]>;
  abstract getCount(filter: IDataBatchListFilter): Promise<number>;
}
