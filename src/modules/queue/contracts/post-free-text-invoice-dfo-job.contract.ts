import {
  D365FOFreeTextInvoiceHeaderRequest,
  D365FOFreeTextInvoiceLineRequest,
} from '@/modules/d365fo/types';

export interface PostFreeTextInvoiceDFOJobPayload {
  batchId: string;
  company: string;
  groupedInvoices: Array<{
    header: D365FOFreeTextInvoiceHeaderRequest;
    lines: D365FOFreeTextInvoiceLineRequest[];
    HeaderDefaultDimensionDisplayValue: string;
    LineFinTagDisplayValues: string[];
  }>;
  correlationId?: string;
  sourceModule?: 'AR';
}
