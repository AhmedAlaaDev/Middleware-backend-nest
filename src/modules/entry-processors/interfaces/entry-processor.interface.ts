import { EntryProcessorTypes } from '../../data-batches/schemas/data-batch.schema';

export interface RawDataModel {
  [key: string]: any;
}

export interface DynDataModel {
  lineNumber?: number;
  errorCount: number;
  dimensionModel?: any;
  sourceIds: string[];
  getErrors(): string[];
  [key: string]: any;
}

export interface IEntryProcessor {
  readonly entryProcessorType: EntryProcessorTypes;
  readonly requiredDimensions: string[];

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

  insertIntoDynamicsAsync(
    data: DynDataModel[],
    company: string,
  ): Promise<void>;

  parseToDimensions(dimensionString: string): any;
  convertToStringDimensions(dimensionsModel: any): string;
}

