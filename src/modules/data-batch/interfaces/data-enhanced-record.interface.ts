export interface IDataEnhancedRecord<TData = Record<string, unknown>> {
  id: string;
  batchId: string;
  dimensionModel?: Record<string, unknown>;
  sourceIds: string[];
  data: TData;
  dataModelType: string;
}

export interface ICreateDataEnhancedRecord<TData = Record<string, unknown>> {
  batchId: string;
  dimensionModel?: Record<string, unknown>;
  sourceIds: string[];
  data: TData;
  dataModelType: string;
}

export type IUpdateDataEnhancedRecord<TData = Record<string, unknown>> =
  Partial<ICreateDataEnhancedRecord<TData>>;
