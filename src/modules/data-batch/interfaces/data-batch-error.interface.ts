import { ApiHideProperty } from '@nestjs/swagger';

export class IDataBatchError<TEnhancedData = Record<string, unknown>> {
  id: string;
  batchId: string;
  sourceRecordIds: string[];
  errorMessages: string[];
  accountDimensionsModel?: Record<string, any>;
  enhancedRecordIds: string[];

  @ApiHideProperty()
  enhancedData?: TEnhancedData;
}

export interface ICreateDataBatchError<
  TEnhancedData = Record<string, unknown>,
> {
  batchId: string;
  sourceRecordIds: string[];
  errorMessages: string[];
  accountDimensionsModel?: Record<string, any>;
  enhancedRecordIds: string[];
  enhancedData?: TEnhancedData;
}

export type IUpdateDataBatchError<TEnhancedData = Record<string, unknown>> =
  Partial<ICreateDataBatchError<TEnhancedData>>;

export interface IDataBatchErrorListFilter {
  batchId?: string;
}
