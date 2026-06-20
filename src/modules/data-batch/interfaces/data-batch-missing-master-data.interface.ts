import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';

export type MissingMasterDataType = 'customer';
export type MissingCustomerField = 'CustomerAccount' | 'TaxExemptNumber';
export type CustomerCreationStatus =
  | 'missing'
  | 'creating'
  | 'created'
  | 'create_failed';
export type BatchReprocessStatus =
  | 'not_started'
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed';

export interface IMissingMasterDataItem {
  type: MissingMasterDataType;
  missingField: MissingCustomerField;
  missingValue: string;
  formDefaults: Record<string, unknown>;
}

export interface IDataBatchMissingMasterData {
  id: string;
  batchId: string;
  company: string;
  entryProcessorType: EntryProcessorTypes;
  type: MissingMasterDataType;
  missingField: MissingCustomerField;
  missingValue: string;
  creationStatus: CustomerCreationStatus;
  reprocessStatus: BatchReprocessStatus;
  affectedCount: number;
  formDefaults?: Record<string, unknown>;
  readonlyFormFields: string[];
  createdData?: Record<string, unknown> | null;
  createErrorMessage?: string | null;
  reprocessErrorMessage?: string | null;
  reprocessAttempts: number;
}

export interface IUpdateDataBatchMissingMasterData {
  creationStatus?: CustomerCreationStatus;
  reprocessStatus?: BatchReprocessStatus;
  affectedCount?: number;
  formDefaults?: Record<string, unknown>;
  readonlyFormFields?: string[];
  createdData?: Record<string, unknown> | null;
  createErrorMessage?: string | null;
  reprocessErrorMessage?: string | null;
  reprocessAttempts?: number;
}
