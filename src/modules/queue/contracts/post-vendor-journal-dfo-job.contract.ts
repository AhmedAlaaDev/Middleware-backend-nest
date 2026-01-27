import {
  D365FOVendorInvoiceJournalHeaderRequest,
  D365FOVendorInvoiceJournalLineRequest,
} from '@/modules/d365fo/types';

export interface PostVendorJournalDFOJobPayload {
  batchId: string;
  company: string;
  groupedJournals: Array<{
    header: D365FOVendorInvoiceJournalHeaderRequest;
    lines: D365FOVendorInvoiceJournalLineRequest[];
  }>;
  correlationId?: string;
  sourceModule?: 'VENDOR';
}
