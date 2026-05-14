import {
  D365FOFreeTextInvoiceHeaderRequest,
  D365FOFreeTextInvoiceLineRequest,
} from '@/modules/d365fo/types';

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

export interface PostFreeTextInvoiceDFOJobPayload {
  batchId: string;
  company: string;
  groupedInvoices: Array<{
    header: D365FOFreeTextInvoiceHeaderRequest;
    lines: D365FOFreeTextInvoiceLineRequest[];
    HeaderDefaultDimensionDisplayValue: string;
    LineFinTagDisplayValues: string[];
    linePostingMeta?: FreeTextInvoiceLinePostingMeta[];
    /** First-line FreeTextNumber (and voucher key when set); identifies the posting group in errors. */
    postingGroupLabel?: string;
  }>;
  correlationId?: string;
  sourceModule?: 'AR';
}
