export interface IDataEnhancedRecord {
  id: string;
  batchId: string;
  dimensionModel?: Record<string, unknown>;
  sourceIds: string[];
  data: Record<string, unknown>;
  dataModelType: string;
}

export interface ICreateDataEnhancedRecord {
  batchId: string;
  dimensionModel?: Record<string, unknown>;
  sourceIds: string[];
  data: Record<string, unknown>;
  dataModelType: string;
}

export type IUpdateDataEnhancedRecord = Partial<ICreateDataEnhancedRecord>;
