import {
  ICreateDataSourceRecord,
  IDataSourceRecord,
} from '@/modules/data-batch/interfaces/data-source-record.interface';

export abstract class DataSourceRecordRepository {
  public abstract insertMany(records: ICreateDataSourceRecord[]): Promise<void>;

  public abstract deleteMany(batchId: string): Promise<void>;

  public abstract getList(batchId?: string): Promise<IDataSourceRecord[]>;

  public abstract getListStream(batchId: string): any;
}
