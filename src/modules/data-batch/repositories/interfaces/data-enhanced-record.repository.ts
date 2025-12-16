import {
  ICreateDataEnhancedRecord,
  IDataEnhancedRecord,
} from '@/modules/data-batch/interfaces/data-enhanced-record.interface';

export abstract class DataEnhancedRecordRepository {
  public abstract insertMany(
    records: ICreateDataEnhancedRecord[],
  ): Promise<void>;

  public abstract deleteMany(batchId: string): Promise<void>;

  public abstract getList(batchId?: string): Promise<IDataEnhancedRecord[]>;

  public abstract getListStream(batchId?: string): any;
}
