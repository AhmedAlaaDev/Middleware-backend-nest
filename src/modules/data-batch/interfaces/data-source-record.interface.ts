export interface IDataSourceRecord<TRawData = Record<string, unknown>> {
  id: string;
  batchId: string;
  data: TRawData;
}

export interface ICreateDataSourceRecord<TRawData = Record<string, unknown>> {
  batchId: string;
  data: TRawData;
}

export type IUpdateDataSourceRecord<TRawData = Record<string, unknown>> =
  Partial<ICreateDataSourceRecord<TRawData>>;
