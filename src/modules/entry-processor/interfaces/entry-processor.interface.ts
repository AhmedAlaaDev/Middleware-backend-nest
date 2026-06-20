import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';
import { RequiredDimensionsConfig } from '@/modules/entry-processor/types';
import { IMissingMasterDataItem } from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';

export interface RawDataModel {
  [key: string]: any;
}

export interface DynDataModel {
  LineNumber?: number;
  ErrorCount: number;
  ErrorsText: string;
  DimensionModel?: EntryDimensionsModel;
  SourceIds: string[];
  GetErrors(): string[];
  AddError(property: string, message: string): void;
  AddMissingMasterData(input: IMissingMasterDataItem): void;
  GetMissingMasterData(): IMissingMasterDataItem[];
  [key: string]: any;
}

export interface IEntryProcessor {
  readonly entryProcessorType: EntryProcessorTypes;
  readonly requiredDimensions: RequiredDimensionsConfig;

  formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]>;

  validateAsync(
    data: DynDataModel[],
    company?: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]> | DynDataModel[];

  insertIntoDynamicsAsync(data: DynDataModel[], company: string): Promise<void>;
}
