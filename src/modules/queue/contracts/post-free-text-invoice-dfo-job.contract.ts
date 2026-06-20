import {
  D365FOFreeTextInvoiceHeaderRequest,
  D365FOFreeTextInvoiceLineRequest,
} from '@/modules/d365fo/types';
import { DurablePostingJobPayload } from '@/modules/queue/contracts/durable-posting-job.contract';

/**
 * Optional per-line debug context (e.g. from AR enhanced records) for DFO failure messages.
 * Length should match `lines` when provided.
 */
export interface FreeTextInvoiceLinePostingMeta {
  batchRecordId: string;
  dataModelType?: string;
  sourceIds: string[];
  voucherInvoiceKey?: string;
  freeTextNumber?: string;
  billingClassification?: string;
  billingCode?: string;
}

export interface FreeTextInvoicePostingGroup {
  header: D365FOFreeTextInvoiceHeaderRequest;
  lines: D365FOFreeTextInvoiceLineRequest[];
  HeaderDefaultDimensionDisplayValue: string;
  HeaderFinTagDisplayValue: string;
  LineFinTagDisplayValues: string[];
  linePostingMeta?: FreeTextInvoiceLinePostingMeta[];
  postingGroupLabel?: string;
}

export type PostFreeTextInvoiceDFOJobPayload = DurablePostingJobPayload;
