import {
  ICreateDataBatchError,
  IDataBatchError,
  IDataBatchErrorListFilter,
} from '@/modules/data-batch/interfaces/data-batch-error.interface';

export abstract class DataBatchErrorRepository {
  public abstract insertMany(
    dataBatchErrors: ICreateDataBatchError[],
  ): Promise<void>;

  public abstract deleteMany(batchId: string): Promise<void>;
  public abstract getList(
    filter: IDataBatchErrorListFilter,
    options?: { skipCount?: number; maxCount?: number },
  ): Promise<IDataBatchError[]>;
  public abstract getCount(filter: IDataBatchErrorListFilter): Promise<number>;
}
