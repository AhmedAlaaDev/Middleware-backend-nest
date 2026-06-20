import {
  CustomerCreationStatus,
  IDataBatchMissingMasterData,
  IUpdateDataBatchMissingMasterData,
  MissingCustomerField,
  MissingMasterDataType,
} from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';

export abstract class DataBatchMissingMasterDataRepository {
  public abstract deleteMany(batchId: string): Promise<void>;

  public abstract getList(
    batchId: string,
    filter?: {
      type?: MissingMasterDataType;
      creationStatus?: CustomerCreationStatus;
    },
  ): Promise<IDataBatchMissingMasterData[]>;

  public abstract findById(
    id: string,
  ): Promise<IDataBatchMissingMasterData | null>;

  public abstract updateOne(
    id: string,
    data: IUpdateDataBatchMissingMasterData,
  ): Promise<void>;

  public abstract claimForCreation(
    id: string,
  ): Promise<IDataBatchMissingMasterData | null>;

  public abstract upsert(
    batchId: string,
    type: MissingMasterDataType,
    missingField: MissingCustomerField,
    missingValue: string,
    data: IUpdateDataBatchMissingMasterData & {
      company: string;
      entryProcessorType: number;
    },
  ): Promise<void>;
}
