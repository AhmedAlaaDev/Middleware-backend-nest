export class IDataBatchError {
  id: string;
  batchId: string;
  sourceRecordIds: string[];
  errorMessages: string[];
  accountDimensionsModel?: Record<string, any>;
  enhancedRecordIds: string[];
}

export interface ICreateDataBatchError {
  batchId: string;
  sourceRecordIds: string[];
  errorMessages: string[];
  accountDimensionsModel?: Record<string, any>;
  enhancedRecordIds: string[];
}

export type IUpdateDataBatchError = Partial<ICreateDataBatchError>;

export interface IDataBatchErrorListFilter {
  batchId?: string;
}
