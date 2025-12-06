export interface IDataSourceRecord {
  id: string;
  batchId: string;
  data: Record<string, unknown>;
}

export interface ICreateDataSourceRecord {
  batchId: string;
  data: Record<string, unknown>;
}

export type IUpdateDataSourceRecord = Partial<ICreateDataSourceRecord>;
