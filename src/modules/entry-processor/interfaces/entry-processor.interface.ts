import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';
import { DimensionKey } from '@/modules/entry-processor/types/dimension-key.type';

export interface RawDataModel {
  [key: string]: any;
}

export interface DynDataModel {
  LineNumber?: number;
  ErrorCount: number;
  ErrorsText: string;
  DimensionModel?: AccountDimensionsModel;
  SourceIds: string[];
  GetErrors(): string[];
  AddError(property: string, message: string): void;
  [key: string]: any;
}

export interface IEntryProcessor {
  readonly entryProcessorType: EntryProcessorTypes;
  readonly requiredDimensions: readonly DimensionKey[];

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
}
