import {
  DataBatchStatus,
  EntryProcessorTypes,
} from '@/modules/data-batch/enums/data-batch.enum';

export interface ICreateDataBatch {
  company: string;
  entryProcessorType: EntryProcessorTypes;
  entryProcessorName: string;
  description: string;
  successCount: number;
  errorCount: number;
  totalFormattedCount: number;
  totalUploadedCount: number;
  status: DataBatchStatus;
  billingCodeId: string | undefined;
}

export type IUpdateDataBatch = Partial<ICreateDataBatch>;

export class IDataBatch {
  id: string;
  company: string;
  entryProcessorType: EntryProcessorTypes;
  entryProcessorName: string;
  description?: string;
  successCount: number;
  errorCount: number;
  totalFormattedCount: number;
  totalUploadedCount: number;
  status: DataBatchStatus;
  billingCodeId?: string;
}
