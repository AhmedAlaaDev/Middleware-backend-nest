import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';

export interface RawDataModel {
  [key: string]: any;
}

export interface DynDataModel {
  lineNumber?: number;
  errorCount: number;
  dimensionModel?: any;
  sourceIds: string[];
  getErrors(): string[];
  addError(property: string, message: string): void;
  [key: string]: any;
}

export interface IEntryProcessor {
  readonly entryProcessorType: EntryProcessorTypes;
  readonly requiredDimensions: readonly string[] | string[];

  formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]>;

  validateAsync(
    data: DynDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]>;

  insertIntoDynamicsAsync(data: DynDataModel[], company: string): Promise<void>;

  parseToDimensions(dimensionString: string): any;
  convertToStringDimensions(dimensionsModel: any): string;
}
